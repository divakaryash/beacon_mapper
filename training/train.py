"""Local supervised segmentation baseline. No API calls, reference lookup, or pretrained downloads."""
import argparse,json,random,time
from pathlib import Path
import cv2
import numpy as np
import torch
from torch import nn
from prepare import OUT,COLORS

MODELS=Path(__file__).resolve().parent/'models'

def block(a,b):return nn.Sequential(nn.Conv2d(a,b,3,padding=1,bias=False),nn.GroupNorm(4,b),nn.ReLU(),nn.Conv2d(b,b,3,padding=1,bias=False),nn.GroupNorm(4,b),nn.ReLU())
class Segmenter(nn.Module):
    def __init__(self):
        super().__init__()
        self.a=block(1,8);self.b=block(8,16);self.c=block(16,32);self.d=block(32,64);self.center=block(64,96)
        self.up_d=block(160,64);self.up_c=block(96,32);self.up_b=block(48,16);self.up_a=block(24,8);self.out=nn.Conv2d(8,6,1)
    def forward(self,x):
        pool=nn.functional.max_pool2d
        a=self.a(x);b=self.b(pool(a,2));c=self.c(pool(b,2));d=self.d(pool(c,2));z=self.center(pool(d,2))
        for skip,decoder in [(d,self.up_d),(c,self.up_c),(b,self.up_b),(a,self.up_a)]:
            z=decoder(torch.cat([nn.functional.interpolate(z,size=skip.shape[-2:],mode='bilinear',align_corners=False),skip],1))
        return self.out(z)

def read(item):
    image=cv2.imread(str(OUT/item['image']),cv2.IMREAD_GRAYSCALE);mask=cv2.imread(str(OUT/item['mask']),cv2.IMREAD_GRAYSCALE)
    if image is None or mask is None or image.shape!=mask.shape or mask.max()>5:raise ValueError('Invalid supervised image/mask pair')
    return image,mask

def infer(model,image,device):
    h,w=image.shape;result=np.zeros((h,w),np.uint8);model.eval()
    with torch.inference_mode():
        for y in range(0,h,192):
            for x in range(0,w,192):
                # Predict a central tile with context on every internal edge.
                y0=max(0,y-32);x0=max(0,x-32);tile=image[y0:min(h,y+224),x0:min(w,x+224)]
                tensor=torch.from_numpy(np.ascontiguousarray(tile[None,None]/255,dtype=np.float32)).to(device)
                pred=model(tensor).argmax(1)[0].cpu().numpy();hh=min(192,h-y);ww=min(192,w-x)
                result[y:y+hh,x:x+ww]=pred[y-y0:y-y0+hh,x-x0:x-x0+ww]
    return result

def evaluate(model,data,device):
    confusion=np.zeros((6,6),np.int64)
    for image,mask in data:
        pred=infer(model,image,device);confusion+=np.bincount((mask.astype(int)*6+pred).ravel(),minlength=36).reshape(6,6)
    union=confusion.sum(0)+confusion.sum(1)-confusion.diagonal();iou=np.divide(confusion.diagonal(),union,out=np.zeros(6),where=union>0)
    return {'foregroundMeanIoU':float(iou[1:][union[1:]>0].mean()),'classIoU':iou.tolist(),'pixelAccuracy':float(confusion.trace()/confusion.sum())}

def train(steps):
    random.seed(42);np.random.seed(42);torch.manual_seed(42);torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu');meta=json.loads((OUT/'dataset.json').read_text())
    if any(i.get('building') not in {'dlf','agi-hospital','pune'} for i in meta['items']):
        raise ValueError('Only DLF, AGI and Pune reference data are allowed.')
    if not all(i.get('alignmentReviewed') for i in meta['items']):raise ValueError('Review alignment PNGs and mark alignmentReviewed in dataset.json before training.')
    train_items=[i for i in meta['items'] if i['split']=='train'];val_items=[i for i in meta['items'] if i['split']=='validation']
    if not train_items or not val_items:
        raise ValueError('Training requires both training and validation floors.')
    if {i['sha256'] for i in train_items}&{i['sha256'] for i in val_items}:
        raise ValueError('The same PDF cannot be in training and validation.')
    building_overlap=bool({i['building'] for i in train_items}&{i['building'] for i in val_items})
    training=[read(i) for i in train_items];validation=[read(i) for i in val_items]
    counts=sum((np.bincount(mask.ravel(),minlength=6) for _,mask in training));weights=np.sqrt(counts.sum()/np.maximum(counts,1));weights=np.clip(weights/weights.mean(),.2,4)
    model=Segmenter().to(device);optimizer=torch.optim.Adam(model.parameters(),lr=.001);loss_fn=nn.CrossEntropyLoss(weight=torch.tensor(weights,dtype=torch.float32,device=device))
    assert model(torch.zeros(1,1,64,64,device=device)).shape==(1,6,64,64)
    MODELS.mkdir(parents=True,exist_ok=True);initial=evaluate(model,validation,device);best=-1;history=[];start=time.time()
    print(json.dumps({'device':str(device),'parameters':sum(p.numel() for p in model.parameters()),'initialValidation':initial}),flush=True)
    for step in range(1,steps+1):
        xs=[];ys=[]
        for _ in range(4):
            image,mask=random.choice(training);h,w=image.shape;y=random.randrange(h-192+1);x=random.randrange(w-192+1);im=image[y:y+192,x:x+192];target=mask[y:y+192,x:x+192];k=random.randrange(4)
            im=np.rot90(im,k);target=np.rot90(target,k)
            if random.random()<.5:im=np.fliplr(im);target=np.fliplr(target)
            xs.append(np.ascontiguousarray(im[None]/255,dtype=np.float32));ys.append(np.ascontiguousarray(target,dtype=np.int64))
        model.train();optimizer.zero_grad();target=torch.from_numpy(np.stack(ys)).to(device);logits=model(torch.from_numpy(np.stack(xs)).to(device))
        probability=logits.softmax(1);truth=nn.functional.one_hot(target,6).permute(0,3,1,2).float();intersection=(probability*truth).sum((0,2,3));denominator=(probability+truth).sum((0,2,3))
        loss=loss_fn(logits,target)+.5*(1-(2*intersection[1:]+1)/(denominator[1:]+1)).mean()
        assert torch.isfinite(loss),'Nonfinite training loss';loss.backward();optimizer.step()
        if step==1 or step%25==0:print(json.dumps({'step':step,'loss':float(loss.detach().cpu()),'seconds':round(time.time()-start,1)}),flush=True)
        if step%200==0 or step==steps:
            metrics=evaluate(model,validation,device);history.append({'step':step,'loss':float(loss.detach().cpu()),**metrics});print(json.dumps({'validation':history[-1]}),flush=True)
            if metrics['foregroundMeanIoU']>best:
                best=metrics['foregroundMeanIoU'];torch.save({'state':model.cpu().state_dict(),'classes':meta['classes'],'step':step,'validation':metrics},MODELS/'annotation-baseline.pt');model.to(device)
    report={'device':str(device),'steps':steps,'seconds':time.time()-start,'seed':42,'architecture':'small-unet-groupnorm-v1','loss':'weighted cross entropy plus foreground Dice','classes':meta['classes'],'trainingItems':[i['id'] for i in train_items],'validationItems':[i['id'] for i in val_items],'sourceHashes':{i['id']:i['sha256'] for i in meta['items']},'trainingBuildings':sorted({i['building'] for i in train_items}),'validationBuildings':sorted({i['building'] for i in val_items}),'initialValidation':initial,'history':history,'bestValidationForegroundMeanIoU':best,'validationScope':'held-out floors within a training building' if building_overlap else 'held-out buildings','limitation':'Small-data baseline. Validation selects the checkpoint. Registration is approximate. Not integrated into the production annotator.'}
    checkpoint=torch.load(MODELS/'annotation-baseline.pt',map_location='cpu',weights_only=True);model.load_state_dict(checkpoint['state']);model.to(device)
    report['selectedStep']=checkpoint['step'];report['trainingSetMetrics']=evaluate(model,training,device)
    (MODELS/'training-report.json').write_text(json.dumps(report,indent=2)+'\n')
    # Verify serialization and produce a real inference preview from the saved checkpoint.
    pred=infer(model,validation[0][0],device);cv2.imwrite(str(OUT/'validation-prediction.png'),cv2.cvtColor(COLORS[pred],cv2.COLOR_RGB2BGR));assert pred.shape==validation[0][1].shape
    print('Saved model, training report and validation prediction.',flush=True)

def predict(pdf):
    import pymupdf
    device=torch.device('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu');checkpoint=torch.load(MODELS/'annotation-baseline.pt',map_location='cpu',weights_only=True);model=Segmenter();model.load_state_dict(checkpoint['state']);model.to(device)
    doc=pymupdf.open(pdf);page=doc[0];scale=1200/max(page.rect.width,page.rect.height);pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),colorspace=pymupdf.csGRAY,alpha=False);image=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width);pred=infer(model,image,device);doc.close()
    features=[]
    for cls in [1,2,3,4]:
        contours,hierarchy=cv2.findContours((pred==cls).astype(np.uint8),cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:continue
        for i,contour in enumerate(contours):
            if hierarchy[0,i,3]>=0 or cv2.contourArea(contour)<24:continue
            rings=[]
            for index in [i]+[j for j in range(len(contours)) if hierarchy[0,j,3]==i]:
                ring=cv2.approxPolyDP(contours[index],1.5,True).reshape(-1,2).tolist()
                if len(ring)>=3:rings.append(ring+[ring[0]])
            if rings:features.append({'type':'Feature','properties':{'category':checkpoint['classes'][cls],'needsReview':True},'geometry':{'type':'Polygon','coordinates':rings}})
    output=OUT/(Path(pdf).stem+'-predicted.geojson');output.write_text(json.dumps({'type':'FeatureCollection','coordinateSystem':'rendered image pixels; origin top-left; not geographic','width':image.shape[1],'height':image.shape[0],'features':features})+'\n');print(output)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=5000);parser.add_argument('--predict',type=Path);args=parser.parse_args()
    if args.steps<1:parser.error('steps must be positive')
    if args.predict:predict(args.predict)
    else:train(args.steps)
