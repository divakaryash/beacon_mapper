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
