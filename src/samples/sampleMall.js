// Hand-modelled demonstration based on the Milestone 2 sample-floor.svg, not a surveyed mall.
const box=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const area=(id,type,x,y,width,height)=>({id,type,layerId:type==="buildingBoundary"?"walls":type==="restrictedArea"?"restrictedAreas":"walkableAreas",floorId:"floor-1",points:box(x,y,width,height),rotation:0});
const node=(id,x,y,type,category)=>({id,x,y,worldX:x*.1,worldY:y*.1,floorId:"floor-1",type,metadata:{label:id,category}});
const edge=(id,source,target,distance)=>({id,source,target,distance,accessibility:true,direction:"both",edgeType:"Walkway"});
export const sampleMall={
  name:"Sample mall · geometry coverage demo",drawingWidthPixels:1200,drawingHeightPixels:760,widthMeters:120,heightMeters:76,gridSize:20,snapToGrid:false,
  objects:[area("boundary","buildingBoundary",70,65,1060,630),area("concourse","walkableArea",410,75,300,610),area("west-retail","walkableArea",80,310,310,200),area("restricted-services","restrictedArea",630,400,70,50),
    {id:"wall-west",type:"wall",layerId:"walls",floorId:"floor-1",points:[{x:400,y:65},{x:400,y:695}],thicknessMeters:.8},
    {id:"wall-east",type:"wall",layerId:"walls",floorId:"floor-1",points:[{x:720,y:65},{x:720,y:695}],thicknessMeters:.8},
    {id:"poi-main",type:"poi",layerId:"pois",x:560,y:90,name:"Main entrance",category:"Entrance",floorId:"floor-1",metadata:{nodeId:"entrance"}},
    {id:"poi-lift",type:"poi",layerId:"pois",x:560,y:660,name:"Lift lobby",category:"Lift",floorId:"floor-1",metadata:{nodeId:"lift"}}],
  graph:{nodes:[node("entrance",560,90,"Entrance"),node("food",560,180,"Room Entrance","Food Court"),node("atrium",560,310,"Junction","Atrium"),node("lift",560,660,"Lift"),node("west",420,310,"Room Entrance"),node("exit",700,310,"Exit")],edges:[edge("entry-food","entrance","food",9),edge("food-atrium","food","atrium",13),edge("atrium-lift","atrium","lift",35),edge("atrium-west","atrium","west",14),edge("atrium-exit","atrium","exit",14)]},
};
export const sampleFloorSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#fffdf9"/><g fill="none" stroke="#aeb6bd" stroke-width="8"><rect x="70" y="65" width="1060" height="630"/><path d="M400 65v235H70M720 65v235h410M400 300v395M720 300v395M70 520h330M720 520h410"/></g><g fill="#768390" font-family="Arial" font-size="25"><text x="165" y="185">West wing</text><text x="500" y="185">Atrium</text><text x="830" y="185">East wing</text><text x="150" y="420">Retail</text><text x="835" y="420">Services</text><text x="500" y="535">Central concourse</text></g></svg>`;
