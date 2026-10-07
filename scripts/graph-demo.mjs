import { NavigationGraph } from "../src/engines/navigationGraph.js";
import { performance } from "node:perf_hooks";
// Two manually defined POIs with explicit graph entrances, not inferred passage through rooms.
const pois=[{id:"entrance-poi",name:"Main Entrance",x:0,y:0,metadata:{nodeId:"entrance"}},{id:"store-poi",name:"West Retail",x:300,y:200,metadata:{nodeId:"store"}}];
const graph=new NavigationGraph();
for(const [id,x,y,type] of [["entrance",0,0,"Entrance"],["junction",300,0,"Junction"],["store",300,200,"Room Entrance"]]) graph.addNode({id,x,y,worldX:x*.1,worldY:y*.1,floorId:"floor-1",type,metadata:{label:id}});
graph.addEdge({source:"entrance",target:"junction"});graph.addEdge({source:"junction",target:"store"});
const route=graph.route(pois[0].metadata.nodeId,pois[1].metadata.nodeId);
console.log(JSON.stringify({from:pois[0].name,to:pois[1].name,orderedNodes:route.nodeIds,distanceMeters:route.totalDistance,walkingSeconds:route.estimatedWalkingTime,validation:graph.validate()},null,2));
graph.addNode({id:"unconnected",x:500,y:500,worldX:50,worldY:50});
console.log("Validation demonstration:",graph.validate().warnings.map(w=>w.code).join(", "));
const large=new NavigationGraph();const begin=performance.now();
for(let y=0;y<101;y++)for(let x=0;x<101;x++)large.addNode({id:`${x}:${y}`,x,y,worldX:x,worldY:y});
for(let y=0;y<101;y++)for(let x=0;x<101;x++){if(x<100)large.addEdge({source:`${x}:${y}`,target:`${x+1}:${y}`});if(y<100)large.addEdge({source:`${x}:${y}`,target:`${x}:${y+1}`});}
const built=performance.now();large.route("0:0","100:100");const routed=performance.now();large.validate();const validated=performance.now();
console.log(JSON.stringify({nodes:large.nodes.size,edges:large.edges.size,buildMs:built-begin,routeMs:routed-built,validationMs:validated-routed},null,2));
