import { analyzeFloorPlan } from './floorPlanAnalysis.js';
import { analyzeVenueReference } from './venueReference.js';
self.onmessage=({data})=>{try{self.postMessage({result:data.reference?analyzeVenueReference(data.reference,data):analyzeFloorPlan(data)});}catch(error){self.postMessage({error:error.message});}};
