import {segmentProjection} from './floorGeometry.js';
import {attachShopDestinations} from './shopDestinations.js';
import {removeEquipmentHoles} from './equipmentHoles.js';
import {auditoriumEnclosures,addAuditoriumSeating} from './auditoriumEnclosures.js';
import {printedShopFaces,straightenPrintedFaces} from './printedShopFaces.js';
import {liftBankCandidates} from './liftBankCandidates.js';
import {splitDeskRows} from './deskRows.js';
import {analyzeFloorPlan} from './floorPlanAnalysis.js';
import {analyzeVenueReference} from './venueReference.js';
import {pairedWallIndex} from './vectorWallFaces.js';
import {useVectorRooms} from './vectorRooms.js';
import {roomsAtDoorways} from './vectorDoorRooms.js';

self.onmessage=({data})=>{
  try{
    if(data.reference){self.postMessage({result:analyzeVenueReference(data.reference,data)});return;}
    let lookup,nearby;
    if(data.vectorStrokes?.length){
      const openings=[...(data.openingSegments||[])];
      const {drawingWidth:w,drawingHeight:h,metersPerPixel:scale}=data;
      const walls=[];
      lookup=pairedWallIndex(data.vectorStrokes,w,h,scale,gap=>{
        const duplicate=openings.some(p=>Math.hypot((p.a.x+p.b.x-gap.a.x-gap.b.x)*w,(p.a.y+p.b.y-gap.a.y-gap.b.y)*h)*scale/2<.5);
        if(!duplicate)openings.push(gap);
      },index=>{nearby=index;},wall=>walls.push(wall));
      data.vectorWallBands=walls;

      data.liftBanks=liftBankCandidates(data.vectorStrokes,w,h,scale,nearby,data.labels);
      const painted=data.wallPaintMask&&(p=>{
        const x=Math.floor(p.x*data.width/w),y=Math.floor(p.y*data.height/h);
        return x>=0&&x<data.width&&y>=0&&y<data.height&&!!data.wallPaintMask[y*data.width+x];
      });
      data.doorRooms=roomsAtDoorways(data.openingSegments||[],nearby,w,h,scale,data.height/data.width,painted);
      data.openingSegments=openings;
    }
    data.shopFaces=printedShopFaces(data);
    if(nearby)straightenPrintedFaces(data.shopFaces,nearby,data.metersPerPixel);
    const result=useVectorRooms(analyzeFloorPlan(data),data,lookup);
    if(nearby&&data.annotationOnly)removeEquipmentHoles(result.objects,data);
    if(nearby)splitDeskRows(result,nearby,data.metersPerPixel,data.labels);
    if(nearby)addAuditoriumSeating(result,auditoriumEnclosures(data.labels||[],nearby,data.metersPerPixel,result.objects),data.metersPerPixel);
    attachShopDestinations(result,data.shopFaces,data.labels);
    // Geometry refinement can leave a valid swing symbol without a reliable
    // room threshold. Keep the detected position available for review.
    const rooms=new Map(result.objects.filter(o=>o.type==='room').map(o=>[o.id,o]));
    for(const door of result.objects){
      if(door.category!=='Room Door'||!door.metadata?.roomId)continue;
      const room=rooms.get(door.metadata.roomId);
      const nearThreshold=room&&[room.points,...(room.holes||[])].some(ring=>ring.some((a,i)=>
        segmentProjection(door,a,ring[(i+1)%ring.length]).distance*data.metersPerPixel<=.6));
      if(nearThreshold)continue;
      delete door.metadata.roomId;
      door.metadata.needsReview=true;
      door.name='Room door';
    }
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message});}
};
