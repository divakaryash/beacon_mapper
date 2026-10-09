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
