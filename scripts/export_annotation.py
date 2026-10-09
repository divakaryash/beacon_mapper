#!/usr/bin/env python3
import argparse,json,sys
from pathlib import Path
from professional_annotation import *
from validate_annotation import validate,report

def export(source,config):
    profile=load_profile(config.get('profile'));scale=config.get('metersPerPixel')
    if not scale or not math.isfinite(scale) or scale<=0:raise ValueError('Provide positive metres per pixel from known dimensions or control points')
    config=copy.deepcopy(config);source=copy.deepcopy(source)
    if len(config.get('controlPoints',[]))>=3:
        fitted=register({'features':[],'metadata':{}},config['controlPoints'],scale,profile)['metadata']['registration']
        factor=math.hypot(fitted['a'],fitted['b'])
        def resize(value):return [value[0]*factor,value[1]*factor] if isinstance(value[0],(int,float)) else [resize(v) for v in value]
        for f in source['features']:f['geometry']['coordinates']=resize(f['geometry']['coordinates'])
        for label in config.get('labels',[]):label['x']*=factor;label['y']*=factor
        scale*=factor;config['scaleSource']={'kind':'surveyed-control-points','count':len(config['controlPoints'])}
    data=taxonomy(source,config['floor'],profile,scale)
    data['metadata']['scaleSource']=config.get('scaleSource');data['metadata']['metersPerPixel']=scale
    data=naming(data,profile,config.get('labels',[]));data=cleanup(data,profile);data=circulation(data,profile);data=linked_points(data,profile)
    routes=routing(data,{},profile) if config.get('routing') else None
    if not config.get('localDiagnostic'):data=register(data,config.get('controlPoints',[]),scale,profile)
    else:
        def pixels(v):return [v[0]/scale,-v[1]/scale] if isinstance(v[0],(int,float)) else [pixels(w) for w in v]
        for f in data['features']:f['geometry']['coordinnatesLocal']=pixels(f['geometry']['coordinates'])
    validation=validate(data,profile,require_registration=not config.get('localDiagnostic'))
    if not validation['valid']:raise ValueError('\n'.join(validation['errors']))
    return {'annotation':data,'routing':routes,'validation':validation,'report':report(data,validation)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',nargs='?');p.add_argument('--config');p.add_argument('--output');p.add_argument('--legacy-output',action='store_true');p.add_argument('--stdin',action='store_true');a=p.parse_args()
    try:
        if a.stdin:
            payload=json.load(sys.stdin);result=export(payload['source'],payload['config']);print(json.dumps(result))
        else:
            source=json.loads(Path(a.source).read_text())
            if a.legacy_output:Path(a.output).write_text(json.dumps(source));sys.exit(0)
            result=export(source,json.loads(Path(a.config).read_text()));Path(a.output).write_text(json.dumps(result['annotation'],indent=2));Path(a.output).with_suffix('.report.md').write_text(result['report'])
            if result['routing']:Path(a.output).with_suffix('.routing.json').write_text(json.dumps(result['routing'],indent=2))
            print(json.dumps(result['validation'],indent=2))
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
