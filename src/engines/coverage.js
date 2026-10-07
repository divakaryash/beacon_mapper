import {compileFloorGeometry,geometryConflict,visibleGeometrySegment,validGraphIntervals} from "./floorGeometry.js";
import {deploymentQuality} from "./deploymentQuality.js";

export const coverageEngineVersion=2;
// Geometric visibility/radius estimates, never RF propagation or signal strengths.
export function analyzeCoverage({graph,floorGeometry,beacons,profile,placementQuality={},configuration={},previous=null,changes=null,compiledFloors=null}) {
  const requestedCellSize=Number(configuration.cellSize??.5),requestedGraphStep=Number(configuration.graphStep??.25);
  if(!(requestedCellSize>0)||!Number.isFinite(requestedCellSize)||!(requestedGraphStep>0)||!Number.isFinite(requestedGraphStep))throw new Error("Coverage resolution must be positive and finite.");
  if(!(Number(profile.coverageRadius)>0)||!Number.isFinite(Number(profile.coverageRadius)))throw new Error("Coverage radius must be positive and finite.");
  const floors=compiledFloors||compileFloorGeometry(floorGeometry),nodes=graph.nodes instanceof Map?graph.nodes:new Map(graph.nodes.map(n=>[n.id,n])),edges=graph.edges instanceof Map?[...graph.edges.values()]:graph.edges;
  const radiusFor=b=>Number(b[configuration.coverageThreshold==="marginal"?"marginalRadius":configuration.coverageThreshold==="reliable"?"reliableRadius":"coverageRadius"]??b.coverageRadius??profile.coverageRadius);
  const incremental=!!(previous&&changes&&previous.resolution.requestedCellSize===requestedCellSize&&previous.resolution.requestedGraphStep===requestedGraphStep&&previous.coverageThreshold===(configuration.coverageThreshold||"nominal"));
  const previousEdges=new Map((previous?.graphEdges||[]).map(e=>[e.edgeId,e])),previousGaps=new Map();
  for(const gap of previous?.gaps||[]){if(!previousGaps.has(gap.edgeId))previousGaps.set(gap.edgeId,[]);previousGaps.get(gap.edgeId).push(gap);}
  const affected=(point,floorId)=>!incremental||changes.some(b=>b.floorId===floorId&&Math.hypot(point.x-b.worldX,point.y-b.worldY)<=radiusFor(b)+1e-7);
  let recomputedCells=0,recomputedEdges=0,reusedFloors=0;
  const warnings=[],active=beacons.filter(b=>b.enabled!==false),groups=new Map();
  for(const b of active) {
    const radius=radiusFor(b);
    if(!(radius>0)||!Number.isFinite(radius)||![b.worldX,b.worldY].every(Number.isFinite))throw new Error("Invalid beacon radius or coordinates.");
    if(geometryConflict({x:b.worldX,y:b.worldY},floors.get(b.floorId))) {warnings.push({code:"invalid-coverage-beacon",beaconId:b.id,message:`${b.id} is outside valid installation geometry and excluded from coverage.`});continue;}
    if(!groups.has(b.floorId))groups.set(b.floorId,[]);groups.get(b.floorId).push({...b,radius});
  }
  const indices=new Map();
  for(const [floorId,list] of groups) {
    const size=list.reduce((max,b)=>Math.max(max,b.radius),.1),bins=new Map();
    for(const b of list){const key=`${Math.floor(b.worldX/size)}:${Math.floor(b.worldY/size)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(b);}
    indices.set(floorId,{size,bins});
  }
  function coverageCount(point,floorId) {
    const index=indices.get(floorId);if(!index)return 0;let count=0;
    const cx=Math.floor(point.x/index.size),cy=Math.floor(point.y/index.size),floor=floors.get(floorId);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of index.bins.get(`${cx+dx}:${cy+dy}`)||[])if(Math.hypot(point.x-b.worldX,point.y-b.worldY)<=b.radius&&visibleGeometrySegment({x:b.worldX,y:b.worldY},point,floor))count++;
    return count;
  }
  const floorReports=[];let totalArea=0,coveredArea=0,overlapArea=0;
  // ponytail: bounded raster estimate; polygon clipping is the upgrade for sub-cell area accuracy.
  const floorBudgets=new Map();let requestedCells=0;
  for(const [floorId,floor] of floors) {
    if(!floor.boundaries.length||(!floor.walkableAreas.length&&!floor.walkablePaths.length)){warnings.push({code:"incomplete-coverage-geometry",floorId,message:`${floorId}: draw a building boundary and walkable geometry before reporting area coverage.`});continue;}
    const points=floor.boundaries.flat(),minX=points.reduce((v,p)=>Math.min(v,p.x),Infinity),maxX=points.reduce((v,p)=>Math.max(v,p.x),-Infinity),minY=points.reduce((v,p)=>Math.min(v,p.y),Infinity),maxY=points.reduce((v,p)=>Math.max(v,p.y),-Infinity);
    const count=Math.ceil((maxX-minX)/requestedCellSize)*Math.ceil((maxY-minY)/requestedCellSize);requestedCells+=count;floorBudgets.set(floorId,{minX,minY,maxX,maxY});
  }
  const cellSize=requestedCellSize*Math.max(1,Math.sqrt(requestedCells/40000));
  if(cellSize>requestedCellSize+1e-6)warnings.push({code:"coverage-resolution",message:`Coverage grid coarsened to ${cellSize.toFixed(2)} m to bound analysis cost.`});
  for(const [floorId,bounds] of floorBudgets) {
    const old=incremental&&previous.floorReports.find(f=>f.floorId===floorId);
    if(old&&!changes.some(b=>b.floorId===floorId)){floorReports.push(old);totalArea+=old.totalArea;coveredArea+=old.coveredArea;overlapArea+=old.overlapArea;reusedFloors++;continue;}
    const floor=floors.get(floorId),columns=Math.ceil((bounds.maxX-bounds.minX)/cellSize),rows=Math.ceil((bounds.maxY-bounds.minY)/cellSize),cells=[];let covered=0,overlap=0;
    if(old&&old.cellSize===cellSize)for(const cell of old.cells){let next=cell;if(affected(cell,floorId)){recomputedCells++;next={...cell,count:coverageCount(cell,floorId)};}cells.push(next);if(next.count)covered++;if(next.count>1)overlap++;}
    else for(let row=0;row<rows;row++)for(let column=0;column<columns;column++) {
      const x=bounds.minX+(column+.5)*cellSize,y=bounds.minY+(row+.5)*cellSize;
      if(geometryConflict({x,y},floor))continue;
      recomputedCells++;const count=coverageCount({x,y},floorId);cells.push({column,row,x,y,count});if(count)covered++;if(count>1)overlap++;
    }
    const deadCells=new Map(cells.filter(c=>!c.count).map(c=>[`${c.column}:${c.row}`,c])),deadZones=[];
    while(deadCells.size) {
      const first=deadCells.values().next().value,stack=[first];deadCells.delete(`${first.column}:${first.row}`);let count=0,minX=first.x,maxX=first.x,minY=first.y,maxY=first.y;
      while(stack.length) {
        const cell=stack.pop();count++;minX=Math.min(minX,cell.x);maxX=Math.max(maxX,cell.x);minY=Math.min(minY,cell.y);maxY=Math.max(maxY,cell.y);
        for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){const key=`${cell.column+dc}:${cell.row+dr}`,next=deadCells.get(key);if(next&&visibleGeometrySegment(cell,next,floor)){deadCells.delete(key);stack.push(next);}}
      }
      deadZones.push({floorId,area:count*cellSize**2,samples:count,bounds:{x:minX-cellSize/2,y:minY-cellSize/2,width:maxX-minX+cellSize,height:maxY-minY+cellSize}});
    }
    const area=cells.length*cellSize**2;totalArea+=area;coveredArea+=covered*cellSize**2;overlapArea+=overlap*cellSize**2;
    floorReports.push({floorId,...bounds,columns,rows,cellSize,cells,deadZones,totalArea:area,coveredArea:covered*cellSize**2,overlapArea:overlap*cellSize**2});
  }
  const totalGraphLength=edges.reduce((sum,e)=>{const a=nodes.get(e.source),b=nodes.get(e.target);return sum+(a&&b&&a.floorId===b.floorId?e.distance:0);},0);
  const graphStep=Math.max(requestedGraphStep,totalGraphLength/100000),graphEdges=[],gaps=[];let graphCoveredLength=0;
  if(graphStep>requestedGraphStep+1e-6)warnings.push({code:"graph-resolution",message:`Graph sampling coarsened to ${graphStep.toFixed(2)} m.`});
  for(const edge of edges) {
    const a=nodes.get(edge.source),b=nodes.get(edge.target);if(!a||!b){warnings.push({code:"invalid-coverage-edge",edgeId:edge.id,message:`${edge.id} has a missing endpoint.`});continue;}
    if(a.floorId!==b.floorId)continue;
    const old=incremental&&previousEdges.get(edge.id);
    if(old&&!changes.some(beacon=>{if(beacon.floorId!==a.floorId)return false;const dx=b.worldX-a.worldX,dy=b.worldY-a.worldY,t=Math.max(0,Math.min(1,((beacon.worldX-a.worldX)*dx+(beacon.worldY-a.worldY)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(beacon.worldX-a.worldX-t*dx,beacon.worldY-a.worldY-t*dy)<=radiusFor(beacon)+1e-7;})){graphEdges.push(old);graphCoveredLength+=old.coveredLength;gaps.push(...(previousGaps.get(edge.id)||[]));continue;}
    recomputedEdges++;
    if(!(edge.distance>0)||!Number.isFinite(edge.distance))throw new Error("Coverage graph requires positive finite edge distances.");
    const count=Math.max(1,Math.ceil(edge.distance/graphStep)),valid=validGraphIntervals({x:a.worldX,y:a.worldY},{x:b.worldX,y:b.worldY},floors.get(a.floorId));
    const cuts=[...Array.from({length:count+1},(_,i)=>i/count),...valid.flat()].sort((a,b)=>a-b).filter((t,i,array)=>!i||t-array[i-1]>1e-9);let covered=0,gapStart=null;
    function closeGap(end) {if(gapStart===null)return;const start=gapStart,t0=start/edge.distance,t1=end/edge.distance;gaps.push({floorId:a.floorId,edgeId:edge.id,start,end,length:end-start,x1:a.x+t0*(b.x-a.x),y1:a.y+t0*(b.y-a.y),x2:a.x+t1*(b.x-a.x),y2:a.y+t1*(b.y-a.y)});gapStart=null;}
    for(let i=1;i<cuts.length;i++) {
      const t=(cuts[i-1]+cuts[i])/2,point={x:a.worldX+t*(b.worldX-a.worldX),y:a.worldY+t*(b.worldY-a.worldY)};
      if(!geometryConflict(point,floors.get(a.floorId))&&coverageCount(point,a.floorId)){covered+=(cuts[i]-cuts[i-1])*edge.distance;closeGap(cuts[i-1]*edge.distance);}else if(gapStart===null)gapStart=cuts[i-1]*edge.distance;
    }
    closeGap(edge.distance);covered=Math.min(edge.distance,covered);graphCoveredLength+=covered;graphEdges.push({edgeId:edge.id,length:edge.distance,coveredLength:covered});
  }
  graphCoveredLength=Math.min(totalGraphLength,graphCoveredLength);
  const deadZones=floorReports.flatMap(f=>f.deadZones),coveragePercentage=totalArea?Math.min(100,100*coveredArea/totalArea):0,graphCoveragePercentage=totalGraphLength?Math.min(100,100*graphCoveredLength/totalGraphLength):0;
  if(deadZones.length)warnings.push({code:"dead-zones",message:`${deadZones.length} dead zone(s), ${(totalArea-coveredArea).toFixed(2)} m² of sampled walkable area.`});
  if(overlapArea)warnings.push({code:"coverage-overlap",message:`${overlapArea.toFixed(2)} m² has two or more visible beacons. Overlap is informational, not a quality penalty.`});
  if(gaps.length)warnings.push({code:"graph-gaps",message:`${gaps.length} graph gap(s), ${(totalGraphLength-graphCoveredLength).toFixed(2)} m uncovered.`});
  if(!totalArea)warnings.push({code:"no-coverage-area",message:"No measurable walkable area. Area coverage is unavailable; zero is not a verified result."});
  const quality=deploymentQuality({...placementQuality,coverageScore:Math.min(coveragePercentage,graphCoveragePercentage),geometryFailures:placementQuality.geometryFailures||!totalArea||warnings.some(w=>w.code==="invalid-coverage-beacon")?1:0});
  return {method:"geometry-line-of-sight-radius",isRFSimulation:false,coverageThreshold:configuration.coverageThreshold||"nominal",work:{incremental,recomputedCells,recomputedEdges,reusedFloors},resolution:{cellSize,graphStep,requestedCellSize,requestedGraphStep},floorReports,deadZones,gaps,coveragePercentage,graphCoveragePercentage,totalArea,coveredArea,deadZoneArea:Math.max(0,totalArea-coveredArea),overlapArea,overlapPercentage:totalArea?100*overlapArea/totalArea:0,graphCoveredLength,totalGraphLength,graphEdges,quality,warnings:[...warnings,...quality.warnings]};
}
