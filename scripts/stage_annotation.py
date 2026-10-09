import argparse,json
from pathlib import Path
from professional_annotation import load_profile,taxonomy,cleanup
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--floor',type=int,required=True);p.add_argument('--meters-per-pixel',type=float);p.add_argument('--output',required=True);p.add_argument('--stage',type=int,default=1)
a=p.parse_args(); result=taxonomy(json.loads(Path(a.source).read_text()),a.floor,load_profile(),a.meters_per_pixel)
if a.stage>=2:result=cleanup(result,load_profile())
Path(a.output).write_text(json.dumps(result,indent=2));print(json.dumps({'stage':a.stage,'features':len(result['features']),'floor':a.floor,'georeferenced':False}))
