#!/usr/bin/env python3
"""Optional comparison; reference annotations are never input to detection."""
import argparse,json,statistics,math
from pathlib import Path
import numpy as np
from shapely.geometry import shape
from shapely.affinity import affine_transform

def compare(mine,reference):
    def areas(data):return [(f,shape(f['geometry'])) for f in data['features'] if f['geometry']['type']=='Polygon' and f['properties'].get('type')!='Boundary']
    a=areas(mine);b=areas(reference);names={f['properties'].get('name'):(g.centroid.x,g.centroid.y) for f,g in b if f['properties'].get('name')}
    matches=[((g.centroid.x,g.centroid.y),names[f['properties']['name']]) for f,g in a if f['properties'].get('name') in names]
    registration='none; insufficient matched names';matrix=[1,0,0,1,0,0]
    if len(matches)>=3:
        source=np.array([m[0] for m in matches]);target=np.array([m[1] for m in matches]);rows=[];values=[]
        if np.linalg.matrix_rank(source-source.mean(axis=0))==2:
            for (x,y),(u,v) in zip(source,target):rows.extend([[x,-y,1,0],[y,x,0,1]]);values.extend([u,v])
            c,s,tx,ty=np.linalg.lstsq(rows,values,rcond=None)[0];matrix=[c,-s,s,c,tx,ty];registration='similarity from matched names'
    elif a and b:
        # Deterministic overlap search: translation and rotation, without fabricating matches.
        ac=np.mean([(g.centroid.x,g.centroid.y) for f,g in a],axis=0);bc=np.mean([(g.centroid.x,g.centroid.y) for f,g in b],axis=0)
        best=(-1,None)
        for degrees in range(0,360,15):
            c=math.cos(math.radians(degrees));s=math.sin(math.radians(degrees));m=[c,-s,s,c,bc[0]-c*ac[0]+s*ac[1],bc[1]-s*ac[0]-c*ac[1]]
            score=sum(max((affine_transform(g,m).intersection(h).area/max(affine_transform(g,m).union(h).area,1e-20) for _,h in b),default=0) for _,g in a)
            if score>best[0]:best=(score,m)
        matrix=best[1];registration='coarse overlap optimizer; review alignment'
    a=[(f,affine_transform(g,matrix)) for f,g in a];candidates=[]
    for i,(f,g) in enumerate(a):
        for j,(h,p) in enumerate(b):
            iou=g.intersection(p).area/max(g.union(p).area,1e-20)
            if iou>=.5:candidates.append((iou,i,j))
    useda=set();usedb=set();pairs=[]
    for iou,i,j in sorted(candidates,reverse=True):
        if i in useda or j in usedb:continue
        useda.add(i);usedb.add(j);pairs.append((i,j,iou))
    types=sorted({f['properties']['type'] for f,g in a+b});bytype={};confusion={}
    for t in types:
        na=sum(f['properties']['type']==t for f,g in a);nb=sum(f['properties']['type']==t for f,g in b);correct=sum(a[i][0]['properties']['type']==b[j][0]['properties']['type']==t for i,j,_ in pairs)
        bytype[t]={'mine':na,'reference':nb,'precision':correct/max(1,na),'recall':correct/max(1,nb)}
        for label,items in [('mine',a),('reference',b)]:
            gs=[g for f,g in items if f['properties']['type']==t]
            bytype[t][label+'MedianArea']=statistics.median(g.area for g in gs) if gs else None;bytype[t][label+'MedianVertices']=statistics.median(len(g.exterior.coords)-1 for g in gs) if gs else None
    for i,j,_ in pairs:
        key=a[i][0]['properties']['type']+' → '+b[j][0]['properties']['type'];confusion[key]=confusion.get(key,0)+1
    return {'registration':registration,'transform':list(map(float,matrix)),'matchedAtIoU0.5':len(pairs),'nameExactMatchRate':sum(a[i][0]['properties'].get('name')==b[j][0]['properties'].get('name') and a[i][0]['properties'].get('name') is not None for i,j,_ in pairs)/max(1,len(pairs)),'types':bytype,'confusionMatrix':confusion,'overlappingPairs':{label:sum(g.intersection(h).area>1e-9 for i,(_,g) in enumerate(items) for _,h in items[i+1:]) for label,items in [('mine',a),('reference',b)]}}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mine');p.add_argument('reference',nargs='?');a=p.parse_args()
    if not a.reference:print(json.dumps({'benchmark':'skipped: no reference supplied'}))
    else:print(json.dumps(compare(json.loads(Path(a.mine).read_text()),json.loads(Path(a.reference).read_text())),indent=2))
