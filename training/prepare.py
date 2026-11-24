"""Align local reference polygons to PDFs; save supervised masks and alignment previews."""
import argparse,hashlib,json
from pathlib import Path
import cv2
import numpy as np
import pymupdf
from scipy.optimize import differential_evolution

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'training/generated'
COLORS=np.array([[255,255,255],[80,185,225],[70,70,90],[95,205,120],[225,130,120],[245,195,55]],dtype=np.uint8)
CLASSES=['background','space','structure','circulation','restricted','space boundary']

def label_type(t):
    if t in ['Store','Outlet','Room','Hall','Booth','Cafeteria','Pharmacy','Pharmacy / Dispensary','Reception','Counter','Male Washroom','Female Washroom','Accessible Washroom','Unisex Washroom','Washroom']:return 1
    if t in ['Wall','Beam','Piller','Pillar']:return 2
    if t in ['Lift','Stairs','Stairs-up','Stairs-down','Steps','Escalator-up','Escalator-down','Escalator']:return 3
    if t in ['Restricted Area','Non Walkable','Green Area']:return 4
    return 0

def prepare(name,floor,path,split):
    doc=pymupdf.open(path);page=doc[0];pix=page.get_pixmap(matrix=pymupdf.Matrix(1200/max(page.rect.width,page.rect.height),1200/max(page.rect.width,page.rect.height)),alpha=False)
    rgb=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,pix.n)[:,:,:3].copy();doc.close()
    features=json.loads((ROOT/f'data/annotation-references/{name}.geojson').read_text())['features']
    features=[f for f in features if f['geometry']['type']=='Polygon' and int(f['properties'].get('floor',f['properties'].get('level',999)))==floor]
    rings=[np.asarray(f['geometry']['coordinnatesLocal'][0],np.float32) for f in features]
    assert rings and all(p.ndim==2 and p.shape[1]==2 and np.isfinite(p).all() for p in rings)
    lo=np.concatenate(rings).min(0);hi=np.concatenate(rings).max(0);center=(lo+hi)/2
    # shortcut: these examples share PDF orientation; add rotation/mirror search for differently oriented plans.
    ink=(rgb.min(2)<235).astype(np.uint8)
    components=cv2.connectedComponentsWithStats(cv2.dilate(ink,np.ones((3,3),np.uint8)),8)[2][1:]
    big=components[(components[:,cv2.CC_STAT_WIDTH]>rgb.shape[1]*.25)&(components[:,cv2.CC_STAT_HEIGHT]>rgb.shape[0]*.25)]
    if not len(big):raise ValueError(f'{name}: cannot locate the drawing for registration')
    box=big[np.argmax(big[:,cv2.CC_STAT_AREA])];x,y,w,h=map(float,box[:4]);initial=np.array([w/(hi[0]-lo[0]),h/(hi[1]-lo[1]),x+w/2,y+h/2,0.])
    samples=[]
    for f,p in zip(features,rings):
        if f['properties'].get('type') not in ['Boundary','Wall','Room','Store']:continue
        for a,b in zip(p,np.roll(p,-1,axis=0)):
            samples.extend(np.linspace(a,b,max(2,min(50,int(np.linalg.norm(b-a)/2)))))
    points=np.asarray(samples,np.float32)[::max(1,len(samples)//6000)]-center
    dist=cv2.distanceTransform(1-ink,cv2.DIST_L2,3)
    def matrix(v):
        sx,sy,tx,ty,angle=v;c,s=np.cos(angle),np.sin(angle)
        a=np.array([[c*sx,-s*sy],[s*sx,c*sy]])
        return a,np.array([tx,ty])-a@center
    def score(v):
        sx,sy,tx,ty,angle=v;c,s=np.cos(angle),np.sin(angle)
        q=points@np.array([[c*sx,s*sx],[-s*sy,c*sy]])+np.array([tx,ty])
        xx=np.rint(q[:,0]).astype(int);yy=np.rint(q[:,1]).astype(int);valid=(xx>=0)&(yy>=0)&(xx<rgb.shape[1])&(yy<rgb.shape[0])
        ds=np.full(len(q),24.);ds[valid]=dist[yy[valid],xx[valid]]
        return np.minimum(ds,24).mean()
    bounds=[(initial[0]*.8,initial[0]*1.2),(initial[1]*.8,initial[1]*1.2),(initial[2]-w*.12,initial[2]+w*.12),(initial[3]-h*.12,initial[3]+h*.12),(-.08,.08)]
    fit=differential_evolution(score,bounds,x0=initial,seed=42,maxiter=120,popsize=12,tol=.001,polish=True)
    a,b=matrix(fit.x);projected=[np.rint(p@a.T+b).astype(np.int32) for p in rings]
    mask=np.zeros(rgb.shape[:2],np.uint8)
    for cls in [1,4,3,2]:
        for f,p in zip(features,projected):
            if label_type(f['properties'].get('type'))==cls:
                cv2.fillPoly(mask,[p],cls)
                for hole in f['geometry']['coordinnatesLocal'][1:]:cv2.fillPoly(mask,[np.rint(np.asarray(hole)@a.T+b).astype(np.int32)],0)
    for f,p in zip(features,projected):
        if label_type(f['properties'].get('type'))==1:cv2.polylines(mask,[p],True,5,2)
    overlay=(rgb*.6+COLORS[mask]*.4).astype(np.uint8)
    for f,p in zip(features,projected):
        if label_type(f['properties'].get('type')):cv2.polylines(overlay,[p],True,(0,120,220),1)
    stem=f'{name}-{floor}';cv2.imwrite(str(OUT/f'{stem}-image.png'),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR));cv2.imwrite(str(OUT/f'{stem}-mask.png'),mask);cv2.imwrite(str(OUT/f'{stem}-alignment.png'),cv2.cvtColor(overlay,cv2.COLOR_RGB2BGR))
    row={'id':stem,'building':name,'floor':floor,'source':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'image':f'{stem}-image.png','mask':f'{stem}-mask.png','alignmentPreview':f'{stem}-alignment.png','meanBoundaryDistancePixels':float(fit.fun),'affine':[a.tolist(),b.tolist()],'split':split,'alignmentReviewed':False}
    print(json.dumps({'id':stem,'distancePixels':fit.fun,'initialDistance':score(initial)}),flush=True)
    return row

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', action='append', nargs=4, required=True,
                        metavar=('BUILDING','FLOOR','SPLIT','PDF'))
    args=parser.parse_args()
    pairs=[]
    seen=set()
    for building,floor,split,filename in args.pair:
        if building not in {'dlf','agi-hospital','pune'}:
            parser.error('Choose dlf, agi-hospital or pune. Apollo is excluded.')
        try:
            floor=int(floor)
        except ValueError:
            parser.error('FLOOR must be an integer')
        path=Path(filename).expanduser().resolve()
        if split not in {'train','validation'} or not path.is_file():
            parser.error(f'Invalid split or missing PDF: {filename}')
        if (building,floor) in seen:
            parser.error(f'Duplicate floor: {building} {floor}')
        seen.add((building,floor))
        pairs.append((building,floor,path,split))
    OUT.mkdir(parents=True,exist_ok=True)
    rows=[prepare(*pair) for pair in pairs]
    (OUT/'dataset.json').write_text(json.dumps({'classes':CLASSES,'items':rows},indent=2)+'\n')
