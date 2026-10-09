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
    def test_floor(self):
        with self.assertRaises(ValueError):taxonomy(sample(),'floor-1')
    def test_presets(self):
        for venue in load_profile()['presets']:
            self.assertEqual(taxonomy(sample(),0,load_profile({'venueType':venue}))['features'][1]['properties']['type'],load_profile()['presets'][venue])

if __name__=='__main__': unittest.main()
