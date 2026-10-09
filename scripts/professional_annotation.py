"""Professional annotation stages. Local diagnostic drafts are never WGS84 exports."""
import json, re, math, copy
from pathlib import Path
from shapely.geometry import shape, mapping, Point, Polygon, LineString
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

PROFILE_PATH = Path(__file__).resolve().parents[1] / 'venue_profile.json'
AREA_ALIASES = {'Store', 'Room', 'Ward', 'Gate', 'Exhibit', 'Enclosure', 'Office', 'Classroom', 'Counter'}
ENTRY_TYPES = AREA_ALIASES | {'Lift', 'Male Washroom', 'Female Washroom'}
REQUIRED = {'level','floor','name','type','direction','surface','isWalkable','visible','hideElement','isForAlign','height','centroid','global'}

def load_profile(overrides=None):
    profile = json.loads(PROFILE_PATH.read_text())
    for key, value in (overrides or {}).items():
        if isinstance(value, dict) and isinstance(profile.get(key), dict): profile[key].update(value)
        else: profile[key] = value
    if profile['venueType'] not in profile['presets']: raise ValueError('Unknown venueType')
    for pattern in profile['namePatterns']: re.compile(pattern)
    return profile

def classify(name, current, profile):
    for category, words in profile['keywords'].items():
        if any(re.search(r'\b'+re.escape(word)+r'\w*\b', name or '', re.I) for word in words): return category
    aliases = {'Room':profile['presets'][profile['venueType']], 'Outlet':profile['presets'][profile['venueType']], 'Void':'Non Walkable','Green Area':'Non Walkable'}
    return aliases.get(current, current)

def taxonomy(source, floor, profile=None, meters_per_pixel=None):
    if type(floor) is not int: raise ValueError('Provide an integer floor number from the sheet or floor configuration')
    profile = profile or load_profile()
    result = {'type':'FeatureCollection','name':source.get('name'), 'metadata':{'stage':1,'coordinateSystem':'local metres diagnostic; not georeferenced','scaleSource':source.get('scaleSource'),'transformations':[],'dropped':[]},'features':[]}
    for item in source['features']:
        f = copy.deepcopy(item); p = f['properties']; category = classify(p.get('name'),p.get('type'),profile)
        if category in {'Navigation Path','Walkable Area'}:
            result['metadata']['dropped'].append({'id':f['id'],'reason':'separate routing / implicit walkable gaps'}); continue
        if category not in ENTRY_TYPES | {'Boundary','Wall','Restricted Area','Non Walkable','Stairs','Escalator','Travelator','Ramp','Vertical circulation'}:
            category = profile['presets'][profile['venueType']]
        name = p.get('name')
        if not name or re.match(r'Detected\b',name,re.I) or len(name.strip())<2: name=None
        p.update(level=floor,floor=floor,name='Boundary' if category=='Boundary' else name,type=category,direction='Bidirectional',surface='accessible',isWalkable=False,visible=True,hideElement=False,isForAlign=False,height=str(profile['defaultHeight']),centroid=None,fillColor=profile['colors'].get(category,'#a4d3df'),needsReview=not bool(name))
        p['global']=False
        if meters_per_pixel:
            def pixels(value):
                if isinstance(value[0],(int,float)): return [value[0]/meters_per_pixel,-value[1]/meters_per_pixel]
                return [pixels(v) for v in value]
            f['geometry']['coordinnatesLocal']=pixels(f['geometry']['coordinates'])
        result['features'].append(f)
    return result

def polygons(geometry):
    if geometry.geom_type=='Polygon': return [geometry]
    if hasattr(geometry,'geoms'): return [p for g in geometry.geoms for p in polygons(g)]
    return []

def area_rank(f):
    t=f['properties']['type']
    return 0 if t in {'Lift','Male Washroom','Female Washroom'} else 1 if t in AREA_ALIASES else {'Restricted Area':2,'Non Walkable':3,'Wall':4}.get(t,2)

def cleanup(data, profile):
    data=copy.deepcopy(data); changes=data['metadata']['transformations']; dropped=data['metadata']['dropped']
    boundaries=[shape(f['geometry']) for f in data['features'] if f['properties']['type']=='Boundary']
    boundary=unary_union(boundaries) if boundaries else None
    candidates=[]; others=[]
    for f in data['features']:
        if f['geometry']['type']!='Polygon' or f['properties']['type']=='Boundary': others.append(f);continue
        g=shape(f['geometry'])
        if not g.is_valid:
            dropped.append({'id':f['id'],'reason':'invalid source outline; requires redrawing'});continue
        simplified=g.simplify(profile['simplifyMeters'],preserve_topology=True)
        if abs(simplified.area-g.area)<=max(.1,g.area*.05): g=simplified
        if boundary is not None:g=g.intersection(boundary)
        p=f['properties']
        if p['type']=='Wall' and (g.area<profile['minimumWallAreaMeters'] or 2*g.area/max(g.length,1e-9)<profile['minimumWallWidthMeters']):
            dropped.append({'id':f['id'],'reason':'thin partition / small ink component, not structural mass'});continue
        candidates.append((f,g))
    # Merge only with positive name identity and explicit absence of a separating partition.
    merged=[]
    for f,g in sorted(candidates,key=lambda item:str(item[0]['id'])):
        target=None
        for i,(other,h) in enumerate(merged):
            if f['properties']['name'] and f['properties']['name']==other['properties']['name'] and f['properties']['type']==other['properties']['type'] and f['properties'].get('noSeparatingPartition') is True and other['properties'].get('noSeparatingPartition') is True and g.boundary.intersection(h.boundary).length>=profile['mergeSharedBoundaryMeters']:
                target=i;break
        if target is None:merged.append((f,g))
        else:
            other,h=merged[target];merged[target]=(other,h.union(g));changes.append({'id':f['id'],'action':'merged','into':other['id']})
    occupied=None; output=others
    for f,g in sorted(merged,key=lambda item:(area_rank(item[0]),str(item[0]['id']))):
        original=g
        if occupied is not None:g=g.difference(occupied)
        if not g.equals(original):changes.append({'id':f['id'],'action':'clipped overlapping lower-priority area','removedArea':original.area-g.area})
        accepted=[]
        for index,part in enumerate(polygons(g)):
            threshold=profile['minimumAreas'].get(f['properties']['type'],profile['minimumArea'])
            if part.is_empty or part.area<=0:continue
            rectangle=part.minimum_rotated_rectangle
            coords=list(rectangle.exterior.coords); lengths=[math.dist(coords[i],coords[i+1]) for i in range(4)]
            aspect=max(lengths)/max(min(lengths),1e-9)
            if part.area<threshold or aspect>profile['maximumAspectRatio']:
                dropped.append({'id':f['id'],'part':index,'reason':'minimum area / extreme sliver','area':part.area});continue
            new=copy.deepcopy(f);new['id']=f['id'] if len(polygons(g))==1 else f"{f['id']}-part-{index+1}"
            new['geometry']=dict(mapping(orient(part,sign=1)));new['properties']['needsReview'] |= not part.equals(shape(f['geometry']))
            output.append(new);accepted.append(part)
        if accepted:occupied=unary_union(([occupied] if occupied is not None else [])+accepted)
    data['features']=output;data['metadata']['stage']=2
    return data

def valid_name(name, profile, repeated=()):
    if not name or re.match(r'Detected\b',name,re.I) or len(name.strip())<3:return False
    if re.search(r'\b(extent|wide fire corridor|scale|legend)\b|\d\s*(mm|m²|sqm)\b',name,re.I):return False
    if any(re.search(pattern,name,re.I) for pattern in profile['namePatterns']):return True
    words=re.findall(r'[A-Za-z]+',name)
    return bool(words) and sum(map(len,words))/len(name)>.65 and (name.casefold() in repeated or any(word.casefold() in profile['dictionary'] for word in words))

def naming(data, profile, labels=()):
    data=copy.deepcopy(data);counts={};repeated={}
    for label in labels:repeated[label['text'].strip().casefold()]=repeated.get(label['text'].strip().casefold(),0)+1
    repeated={k for k,v in repeated.items() if v>1}
    for f in data['features']:
        p=f['properties'];g=shape(f['geometry'])
        if p['type']=='Boundary':continue
        candidates=[p.get('name')]
        nearby=[l for l in labels if g.covers(Point(l['x'],l['y']))]
        nearby.sort(key=lambda l:(l.get('source')!='pdf-text',-l.get('confidence',0),l['text']))
        candidates=[l['text'].strip() for l in nearby]+candidates
        name=next((n for n in candidates if valid_name(n,profile,repeated)),None)
        category=classify(' '.join(n for n in candidates if n),p['type'],profile)
        if category in {'Male Washroom','Female Washroom'}:
            counts[category]=counts.get(category,0)+1;name=f'{category}-{counts[category]}'
        p.update(name=name,type=category,fillColor=profile['colors'].get(category,'#a4d3df'),needsReview=p.get('needsReview',False) or name is None)
    data['metadata']['stage']=3
    return data

def circulation(data, profile):
    data=copy.deepcopy(data);counts={};output=[]
    for f in sorted(data['features'],key=lambda f:str(f['id'])):
        p=f['properties'];t=p['type']
        if t=='Vertical circulation':
            data['metadata']['dropped'].append({'id':f['id'],'reason':'unknown circulation assembly; cannot infer stairs versus escalator','needsReview':True});continue
        if t in {'Stairs','Escalator','Travelator','Ramp'}:
            footprint=shape(f['geometry']);point=footprint.representative_point()
            p['blockedFootprint']=mapping(footprint);f['geometry']=dict(mapping(point))
            counts[t]=counts.get(t,0)+1
            direction=p.get('travelDirection') if p.get('directionEvidence') else None
            if direction not in {'Up','Down'}:direction=None
            p['name']=f'Stairs-{counts[t]}' if t=='Stairs' else f"{'E' if t=='Escalator' else t}-{counts[t]}"+(f' {direction}' if direction else '')
            p['travelDirection']=direction;p['needsReview']=p.get('needsReview',False) or (t=='Escalator' and direction is None)
        output.append(f)
    data['features']=output;data['metadata']['stage']=4;return data

def linked_points(data,profile):
    data=copy.deepcopy(data);areas=[f for f in data['features'] if f['geometry']['type']=='Polygon'];output=list(data['features'])
    boundary=unary_union([shape(f['geometry']) for f in areas if f['properties']['type']=='Boundary'])
    obstacles=unary_union([shape(f['geometry']) for f in areas if f['properties']['type']!='Boundary'])
    for f in areas:
        p=f['properties'];g=shape(f['geometry']);center=g.representative_point();p['centroid']=list(center.coords[0]);p['associatedPoints']=[]
        cp=copy.deepcopy(p);cp.update(type='Centroid',polygonType=p['type'],associatedPolygons=[f['id']],associatedPoints=[])
        output.append({'type':'Feature','id':str(f['id'])+'-centroid','properties':cp,'geometry':dict(mapping(center))})
        if p['type'] not in ENTRY_TYPES:continue
        candidates=[];ring=list(orient(g).exterior.coords)
        for a,b in zip(ring,ring[1:]):
            length=math.dist(a,b)
            if length<.2:continue
            projection=Point((a[0]+b[0])/2,(a[1]+b[1])/2);nx=(b[1]-a[1])/length;ny=-(b[0]-a[0])/length
            door=Point(projection.x+nx*profile['doorOffsetMeters'],projection.y+ny*profile['doorOffsetMeters'])
            probe=LineString([door,Point(projection.x+nx*2,projection.y+ny*2)])
            if boundary.is_empty or not boundary.covers(door) or obstacles.covers(door):continue
            candidates.append((probe.difference(obstacles).length,length,door,projection,nx,ny))
        if candidates:
            _,_,door,projection,nx,ny=max(candidates,key=lambda c:(c[0],c[1],-c[2].x,-c[2].y))
        else:
            projection=g.exterior.interpolate(.5,normalized=True);door=projection;nx=ny=0
        dp=copy.deepcopy(p);dp.update(type='Point',associatedPolygons=[f['id']],associatedPoints=[],closestProjection=list(projection.coords[0]),entryDirection=(math.degrees(math.atan2(-nx,-ny))+360)%360 if nx or ny else None,openingDirection=None,entryConfidence=.25,needsReview=True,entryEvidence='corridor-facing-edge' if candidates else 'no accessible candidate')
        id=str(f['id'])+'-entry';p['associatedPoints']=[id]
        output.append({'type':'Feature','id':id,'properties':dp,'geometry':dict(mapping(door))})
    data['features']=output;data['metadata']['stage']=5;return data
