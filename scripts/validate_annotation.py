#!/usr/bin/env python3
import json,sys,statistics
from pathlib import Path
from shapely.ops import unary_union
from shapely import transform
from shapely.geometry import shape,Point
from professional_annotation import REQUIRED,ENTRY_TYPES,load_profile

def validate(data,profile=None,require_registration=True,adjacent_floors=()):
    profile=profile or load_profile(data.get('metadata',{}).get('profile'));errors=[];warnings=[];features=data.get('features',[]);ids={};floor=None;areas=[];stats={}
    registration=data.get('metadata',{}).get('registration')
    if require_registration and (not registration or data.get('metadata',{}).get('coordinateSystem')!='WGS84'):errors.append('Surveyed registration required for professional geographic export')
    if registration:
        controls=registration.get('controlPoints',[])
        if len(controls)<3:errors.append('Registration must retain at least three surveyed control pairs')
        for control in controls:
            x,y=control['pixel'][0]*registration['metersPerPixel'],-control['pixel'][1]*registration['metersPerPixel']
            expected=[registration['a']*x-registration['b']*y+registration['tx'],registration['b']*x+registration['a']*y+registration['ty']]
            actual=[(control['longitude']-registration['origin'][0])*registration['eastMetersPerDegree'],(control['latitude']-registration['origin'][1])*registration['northMetersPerDegree']]
            import math
            if math.dist(expected,actual)>profile['registrationResidualMeters']:errors.append('Registration control residual exceeds threshold')
    if not data.get('metadata',{}).get('scaleSource'):warnings.append('Physical scale unverified: areas/distances diagnostic only')
    def metres(g):
        if not registration:return g
        east=registration['eastMetersPerDegree'];north=registration['northMetersPerDegree'];lon,lat=registration['origin']
        return transform(g,lambda x,y:((x-lon)*east,(y-lat)*north),interleaved=False)
    for f in features:
        id=f.get('id');p=f.get('properties',{})
        if id is None:errors.append('Feature id required')
        if id in ids:errors.append(f'Duplicate id: {id}')
        ids[id]=f
        missing=REQUIRED-set(p)
        if missing:errors.append(f'{id}: missing properties {sorted(missing)}')
        if type(p.get('floor')) is not int or type(p.get('level')) is not int:errors.append(f'{id}: floor/level must be integer')
        if floor is None:floor=p.get('floor')
        elif p.get('floor')!=floor:errors.append(f'{id}: inconsistent floor')
        if p.get('level')!=p.get('floor'):errors.append(f'{id}: level and floor differ')
        name=p.get('name')
        if name is not None and (not isinstance(name,str) or len(name.strip())<2 or name.lower().startswith('detected')):errors.append(f'{id}: invalid name')
        if require_registration and (not p.get('global') or 'coordinnatesLocal' not in f.get('geometry',{})):errors.append(f'{id}: global/source coordinates missing')
        if p.get('type') in ENTRY_TYPES and f.get('geometry',{}).get('type')!='Polygon':errors.append(f'{id}: room/lift/washroom must be an area')
        try:g=metres(shape(f['geometry']))
        except Exception as e:errors.append(f'{id}: geometry error {e}');continue
        if not g.is_valid or g.is_empty:errors.append(f'{id}: invalid/empty geometry')
        if g.geom_type=='Polygon':
            if g.area<=0:errors.append(f'{id}: zero area')
            if not g.exterior.is_ccw:errors.append(f'{id}: exterior must be counterclockwise')
            areas.append((f,g));stats.setdefault(p.get('type'),[]).append((g.area,len(g.exterior.coords)-1))
    boundary=unary_union([g for f,g in areas if f['properties']['type']=='Boundary'])
    if boundary.is_empty:errors.append('Building boundary required')
    for f in features:
        if not boundary.is_empty and not boundary.buffer(1e-5).covers(metres(shape(f['geometry']))):errors.append(f"{f['id']}: outside boundary")
    nonboundary=[(f,g) for f,g in areas if f['properties']['type']!='Boundary']
    for i,(a,g) in enumerate(nonboundary):
        for b,h in nonboundary[i+1:]:
            if g.intersection(h).area>max(profile['overlapAreaMeters'],profile['overlapFraction']*min(g.area,h.area)):errors.append(f"Overlap: {a['id']} / {b['id']}")
    for f,g in areas:
        id=f['id'];p=f['properties'];centroids=[c for c in features if c['properties'].get('type')=='Centroid' and c['properties'].get('associatedPolygons')==[id]]
        if len(centroids)!=1:errors.append(f'{id}: exactly one centroid required')
        elif p.get('associatedCentroid')!=centroids[0]['id']:errors.append(f'{id}: centroid link missing')
        elif not g.covers(metres(shape(centroids[0]['geometry']))):errors.append(f'{id}: centroid outside area')
        if p['type'] not in ENTRY_TYPES:continue
        doors=[d for d in features if d['properties'].get('type')=='Point' and d['properties'].get('associatedPolygons')==[id]]
        if len(doors)!=1 or p.get('associatedPoints')!=[doors[0]['id']]:errors.append(f'{id}: exactly one bidirectionally linked entry required');continue
        d=doors[0];dp=d['properties']
        if g.boundary.distance(metres(shape(d['geometry'])))>profile['doorEdgeToleranceMeters'] and not dp.get('needsReview'):errors.append(f'{id}: entry far from edge')
        if not {'entryDirection','closestProjection','openingDirection','entryConfidence'}<=set(dp):errors.append(f'{id}: entry metadata missing')
    for f in features:
        for id in f['properties'].get('associatedPolygons',[]):
            if id not in ids:errors.append(f"{f['id']}: unresolved polygon link {id}")
    blocked=unary_union([g for f,g in nonboundary]+[metres(shape(f['properties']['blockedFootprint'])) for f in features if f['properties'].get('blockedFootprint')])
    free=boundary.difference(blocked)
    from professional_annotation import polygons
    components=polygons(free);common=set(range(len(components)))
    doors=[f for f in features if f['properties']['type']=='Point']
    for door in doors:
        point=metres(shape(door['geometry']));reachable={i for i,g in enumerate(components) if g.distance(point)<.1};common &= reachable
    corridor_fraction=sum(components[i].area for i in common)/max(free.area,1e-9) if doors else None
    if doors and corridor_fraction<.9:warnings.append(f'Corridor area reachable from every inferred entry: {corridor_fraction:.1%}; review segmentation and entries')
    for adjacent in adjacent_floors:
        if not registration or not adjacent.get('metadata',{}).get('registration'):
            warnings.append('Cannot compare circulation positions across unregistered floors');continue
        neighbors=[f for f in adjacent.get('features',[]) if f['properties'].get('type') in {'Lift','Stairs','Escalator'} and abs(f['properties'].get('floor',floor)-floor)==1]
        for f in features:
            if f['properties']['type'] not in {'Lift','Stairs','Escalator'}:continue
            g=metres(shape(f['geometry'])).representative_point()
            if not any(n['properties']['type']==f['properties']['type'] and g.distance(metres(shape(n['geometry'])).representative_point())<=profile.get('counterpartDistanceMeters',10) for n in neighbors):warnings.append(f"{f['id']}: no nearby {f['properties']['type']} counterpart on adjacent floor")
    total=sum(g.area for f,g in nonboundary);wall=sum(g.area for f,g in nonboundary if f['properties']['type']=='Wall')
    if sum(f['properties']['type']=='Wall' for f,g in nonboundary)>len(nonboundary)*.15:warnings.append('Wall count exceeds 15% of area feature count')
    for t,values in stats.items():
        for area,_ in values:
            if t in ENTRY_TYPES and (area<3 or t=='Lift' and area>30):warnings.append(f'{t}: unusual area {area:.2f} m²')
    review_fraction=sum(bool(f['properties'].get('needsReview')) for f in features)/max(1,len(features))
    if review_fraction>.25:warnings.append(f'{review_fraction:.1%} of features require review; geometry validity is not detection accuracy')
    return {'valid':not errors,'errors':errors,'warnings':warnings,'counts':{t:sum(f['properties']['type']==t for f in features) for t in sorted({f['properties']['type'] for f in features})},'nullNameFraction':sum(f['properties'].get('name') is None for f in features)/max(1,len(features)),'reviewFraction':sum(bool(f['properties'].get('needsReview')) for f in features)/max(1,len(features)),'areaStatistics':{t:{'medianArea':statistics.median(a for a,v in values),'medianVertices':statistics.median(v for a,v in values)} for t,values in stats.items()},'corridorReachableFraction':corridor_fraction,'nonWalkableAreaFraction':sum(g.area for f,g in nonboundary if f['properties']['type']=='Non Walkable')/max(boundary.area,1e-9),'restrictedAreaFraction':sum(g.area for f,g in nonboundary if f['properties']['type']=='Restricted Area')/max(boundary.area,1e-9),'wallAreaFraction':wall/max(total,1e-9),'registration':registration}

def report(data,result):
    lines=['# Annotation report',f"Valid: {result['valid']}",f"Coordinate system: {data.get('metadata',{}).get('coordinateSystem')}",'## Counts']
    lines.extend(f'- {t}: {n}' for t,n in result['counts'].items());lines+=['## Errors']+result['errors']+['## Warnings']+result['warnings']+['## Review queue']
    lines.extend(f"- {f['id']} | {f['properties'].get('name')} | {f['geometry']['coordinates']}" for f in data['features'] if f['properties'].get('needsReview') and f['geometry']['type']=='Point')
    lines+=['## Transformations',json.dumps(data.get('metadata',{}),indent=2)];return '\n\n'.join(lines)

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('file');p.add_argument('--local-diagnostic',action='store_true');p.add_argument('--report');p.add_argument('--adjacent-floor',action='append',default=[]);a=p.parse_args();data=json.loads(Path(a.file).read_text());result=validate(data,require_registration=not a.local_diagnostic,adjacent_floors=[json.loads(Path(path).read_text()) for path in a.adjacent_floor])
    if a.report:Path(a.report).write_text(report(data,result))
    print(json.dumps(result,indent=2));sys.exit(0 if result['valid'] else 1)

def validate_routing(annotation,routes):
    features=routes['features'];nodes={f['id']:shape(f['geometry']) for f in features if f['geometry']['type']=='Point'}
    boundary=unary_union([shape(f['geometry']) for f in annotation['features'] if f['properties']['type']=='Boundary'])
    blockers=unary_union([shape(f['geometry']) for f in annotation['features'] if f['geometry']['type']=='Polygon' and f['properties']['type']!='Boundary']+[shape(f['properties']['blockedFootprint']) for f in annotation['features'] if f['properties'].get('blockedFootprint')])
    errors=[]
    if len({f['id'] for f in features})!=len(features):errors.append('Duplicate routing ids')
    for f in features:
        g=shape(f['geometry'])
        if not g.is_valid or g.is_empty or not boundary.buffer(1e-7).covers(g):errors.append(f"{f['id']}: invalid routing geometry / outside boundary")
        if g.geom_type=='LineString':
            if g.length<=0 or g.intersection(blockers).length>1e-7:errors.append(f"{f['id']}: route crosses blocked geometry")
            for key,coordinate in [('source',g.coords[0]),('target',g.coords[-1])]:
                id=f['properties'].get(key)
                if id not in nodes or nodes[id].distance(Point(coordinate))>1e-6:errors.append(f"{f['id']}: unresolved / displaced endpoint")
    return {'valid':not errors,'errors':errors,'featureCount':len(features)}
