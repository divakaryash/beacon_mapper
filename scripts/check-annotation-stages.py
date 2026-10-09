import json,sys
from pathlib import Path
from professional_annotation import *
from validate_annotation import validate,report
source=json.loads(Path(sys.argv[1]).read_text());profile=load_profile();data=taxonomy(source,2,profile,100/1191);summary=[]
for stage,operation in [(1,None),(2,cleanup),(3,naming),(4,circulation),(5,linked_points)]:
    if operation:data=operation(data,profile)
    checks={'stage':stage,'features':len(data['features']),'integerFloors':all(type(f['properties']['floor']) is int for f in data['features']),'placeholderNames':sum((f['properties'].get('name') or '').lower().startswith('detected') for f in data['features'])}
    areas=[shape(f['geometry']) for f in data['features'] if f['geometry']['type']=='Polygon' and f['properties']['type']!='Boundary']
    checks['overlappingPairs']=sum(g.intersection(h).area>max(.1,.005*min(g.area,h.area)) for i,g in enumerate(areas) for h in areas[i+1:])
    if stage>=5:checks['validation']=validate(data,require_registration=False)
    summary.append(checks)
summary.append({'stage':6,'geographicExport':'blocked: real mall has no surveyed control points'})
Path('reports/professional/stage-checks.json').write_text(json.dumps(summary,indent=2));print(json.dumps([{k:v for k,v in r.items() if k!='validation'} for r in summary]))
