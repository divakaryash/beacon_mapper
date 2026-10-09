import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from professional_annotation import *

def feature(id, box, name='Room 101', kind='Room'):
    return {'type':'Feature','id':id,'properties':{'name':name,'type':kind},'geometry':mapping(Polygon(box))}

def sample():
    return {'type':'FeatureCollection','features':[feature('boundary',[(0,0),(30,0),(30,30),(0,30)],'Boundary','Boundary'),feature('room',[(2,2),(10,2),(10,10),(2,10)])]}

class AnnotationTests(unittest.TestCase):
    def test_schema(self):
        result=taxonomy(sample(),2,meters_per_pixel=1)
        for f in result['features']:
            self.assertFalse(REQUIRED-set(f['properties']))
            self.assertEqual(f['properties']['floor'],2)
            self.assertIn('coordinnatesLocal',f['geometry'])
    def test_overlap(self):
        source=sample();source['features'].append(feature('other',[(5,5),(15,5),(15,15),(5,15)],'Room 102'))
        output=cleanup(taxonomy(source,0),load_profile())
        rooms=[shape(f['geometry']) for f in output['features'] if f['properties']['type']!='Boundary']
        self.assertEqual(rooms[0].intersection(rooms[1]).area,0)
    def test_merge(self):
        source=sample();source['features'][1]['properties']['noSeparatingPartition']=True
        f=feature('other',[(10,2),(18,2),(18,10),(10,10)]);f['properties']['noSeparatingPartition']=True;source['features'].append(f)
        output=cleanup(taxonomy(source,0),load_profile())
        self.assertEqual(len(output['features']),2)
    def test_names(self):
        p=load_profile()
        for name in ['A','WE','Detected room 12','Extent 3 x 5 m','ng']:self.assertFalse(valid_name(name,p))
        for name in ['E347','B305A','3K14A','GL-01','Room 101','Reception']:self.assertTrue(valid_name(name,p))
    def test_circulation(self):
        source=sample();source['features'][1]['properties'].update(type='Escalator',name='Escalator')
        f=circulation(taxonomy(source,0),load_profile())['features'][1]
        self.assertEqual(f['geometry']['type'],'Point');self.assertIsNone(f['properties']['travelDirection']);self.assertTrue(f['properties']['needsReview'])
    def test_entries_centroids(self):
        output=linked_points(taxonomy(sample(),0),load_profile());items={f['id']:f for f in output['features']}
        room=items['room'];door=items[room['properties']['associatedPoints'][0]]
        self.assertEqual(door['properties']['associatedPolygons'],['room'])
        self.assertLess(shape(room['geometry']).boundary.distance(shape(door['geometry'])),1)
        self.assertTrue(shape(room['geometry']).contains(shape(items['room-centroid']['geometry'])))
    def test_registration(self):
        data=linked_points(taxonomy(sample(),0),load_profile())
        controls=[{'pixel':[x,y],'latitude':28-y/111319.490793,'longitude':77+x/(111319.490793*math.cos(math.radians(28)))} for x,y in [(0,0),(30,0),(0,30),(30,30)]]
        output=register(data,controls,1,load_profile());self.assertLess(output['metadata']['registration']['maximumResidualMeters'],.01)
        self.assertTrue(all(f['properties']['global'] for f in output['features']))
        controls[3]['latitude']+=.001
        with self.assertRaises(ValueError):register(data,controls,1,load_profile())
    def test_routing(self):
        source=sample();source['features'].append(feature('second',[(18,2),(26,2),(26,10),(18,10)],'Room 102'))
        data=linked_points(taxonomy(source,0),load_profile())
        result=routing(data,{},load_profile());edges=[f for f in result['features'] if f['geometry']['type']=='LineString']
        self.assertGreater(len(edges),0);self.assertLess(len(edges),20)
        for edge in edges:self.assertLess(shape(edge['geometry']).intersection(shape(data['features'][1]['geometry'])).length,1e-7)
    def test_validator(self):
        from validate_annotation import validate
        data=linked_points(taxonomy(sample(),0),load_profile())
        self.assertTrue(validate(data,require_registration=False)['valid'])
        data['features'][-1]['properties']['associatedPolygons']=['missing']
        self.assertFalse(validate(data,require_registration=False)['valid'])
    def test_campus_export(self):
        from export_annotation import export
        source=json.loads((Path(__file__).parent/'synthetic_campus.json').read_text())
        result=export(source,{'floor':0,'metersPerPixel':1,'localDiagnostic':True,'profile':{'venueType':'campus'},'routing':True})
        self.assertTrue(result['validation']['valid']);self.assertGreater(result['routing']['metadata']['doorReachableFraction'],0)
    def test_benchmark(self):
        from compare_to_reference import compare
        data=taxonomy(sample(),0);r=compare(data,data)
        self.assertEqual(r['matchedAtIoU0.5'],1);self.assertEqual(r['nameExactMatchRate'],1)
    def test_ungendered_washroom(self):
        self.assertEqual(classify('WC', 'Room', load_profile()),'Washroom')
        self.assertEqual(classify('Women Toilet','Room',load_profile()),'Female Washroom')
    def test_thin_wall_network(self):
        source=sample();network=unary_union([Polygon([(1,1),(29,1),(29,1.4),(1,1.4)]),Polygon([(1,1),(1.4,1),(1.4,29),(1,29)]),Polygon([(18,18),(23,18),(23,23),(18,23)])])
        source['features'].append({'type':'Feature','id':'walls','properties':{'type':'Wall','name':None},'geometry':mapping(network)})
        source['features'][-1]['geometry']=mapping(Polygon([(1,1),(23,1),(23,23),(18,23),(18,1.4),(1,1.4)]))
        output=cleanup(taxonomy(source,0),load_profile());walls=[shape(f['geometry']) for f in output['features'] if f['properties']['type']=='Wall']
        self.assertTrue(all(g.area>=8 for g in walls));self.assertTrue(all(not g.covers(Point(2,1.2)) for g in walls))
    def test_entry_prefers_main_corridor_component(self):
        source=sample();source['features'][1]=feature('room',[(8,0),(12,0),(12,30),(8,30)])
        output=linked_points(taxonomy(source,0),load_profile());door=next(f for f in output['features'] if f['properties']['type']=='Point')
        self.assertGreater(door['geometry']['coordinates'][0],12)
    def test_unlabeled_small_cell(self):
        source=sample();source['features'][1]=feature('cell',[(2,2),(5,2),(5,5),(2,5)],None)
        output=naming(taxonomy(source,0),load_profile())
        self.assertEqual(output['features'][1]['properties']['type'],'Restricted Area')
    def test_gap_snapping(self):
        source=sample();source['features'].append(feature('second',[(10.1,2),(18,2),(18,10),(10.1,10)],'Room 102'))
        result=cleanup(taxonomy(source,0),load_profile());rooms=[shape(f['geometry']) for f in result['features'] if f['properties']['type']!='Boundary']
        self.assertEqual(rooms[0].distance(rooms[1]),0)
    def test_routing_validator_rejects_room_crossing(self):
        from validate_annotation import validate_routing
        data=linked_points(taxonomy(sample(),0),load_profile());routes={'features':[{'id':'a','properties':{},'geometry':mapping(Point(1,6))},{'id':'b','properties':{},'geometry':mapping(Point(20,6))},{'id':'edge','properties':{'source':'a','target':'b'},'geometry':mapping(LineString([(1,6),(20,6)]))}]}
        self.assertFalse(validate_routing(data,routes)['valid'])
    def test_embedded_label_box_center(self):
        data=taxonomy(sample(),0);labels=[{'text':'Room 777','x':1.5,'y':6,'width':5,'height':1,'source':'pdf-text','confidence':100}]
        result=naming(data,load_profile(),labels)
        self.assertEqual(result['features'][1]['properties']['name'],'Room 777')
    def test_floor(self):
        with self.assertRaises(ValueError):taxonomy(sample(),'floor-1')
    def test_presets(self):
        for venue in load_profile()['presets']:
            self.assertEqual(taxonomy(sample(),0,load_profile({'venueType':venue}))['features'][1]['properties']['type'],load_profile()['presets'][venue])

if __name__=='__main__': unittest.main()
