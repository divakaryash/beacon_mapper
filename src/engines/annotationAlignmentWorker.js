import {refineAnnotationEdges} from '../models/annotationEdgeAlignment.js';
self.onmessage=({data})=>{try{self.postMessage({result:refineAnnotationEdges(data.reference,data.raster,data.drawing)});}catch(error){self.postMessage({error:error.message});}};
