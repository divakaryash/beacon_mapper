import {pointInPolygon} from './floorGeometry.js';
import {destinationCategory} from '../models/destinationCategory.js';

// Pair the printed storefront caption with the final editable polygon after
// splits and contour refinement. Keep the unit number for lookup and export.
export function attachShopDestinations(result,faces,labels=[]){
  const rooms=result.objects.filter(o=>o.type==='room');
  const pins=result.objects.filter(o=>o.type==='poi'&&o.category==='Shop unit');
  const owns=(room,p)=>pointInPolygon(p,room.points)&&!room.holes?.some(h=>pointInPolygon(p,h));
  for(const {caption} of faces){
    const owners=rooms.filter(room=>owns(room,caption));
    if(owners.length!==1)continue;
    const room=owners[0],unit=destinationCategory(caption.text)==='Shop unit';
    // Clinical room faces also use the printed-enclosure pass.
    if(!unit&&!caption.tenant)continue;
    const matches=pins.filter(p=>owns(room,p));
    if(matches.length>1)continue;
    const name=unit&&room.name?.includes(caption.text)?room.name:caption.text;
    let pin=matches[0];
    if(!pin){
      pin={id:'auto-shop-'+room.id,type:'poi',category:'Shop unit',layerId:'pois',floorId:room.floorId,
        x:caption.x,y:caption.y,rotation:0,origin:'automatic'};
      result.objects.push(pin);pins.push(pin);result.analysis.detected.labeledLandmarks++;
    }
    pin.name=name;
    pin.metadata={...pin.metadata,roomId:room.id,coordinateSource:'Printed storefront caption',needsReview:true};
    if(unit)pin.metadata.unitNumber=caption.text;
    room.name=name;
    room.metadata={...room.metadata,labelSource:'Printed storefront caption',needsReview:true};
  }
  // Mall plans often stack the tenant name directly beneath its unit code.
  // Use the label baseline and height in drawing coordinates at any page scale.
  for(const pin of pins){
    if(destinationCategory(pin.name)!=='Shop unit')continue;
    const room=rooms.find(r=>r.id===pin.metadata?.roomId);
    if(!room||!owns(room,pin)||pins.some(p=>p!==pin&&owns(room,p)))continue;
    const unit=labels.find(l=>l.text.trim()===pin.name&&l.height>0&&
      owns(room,{x:l.x+l.width/2,y:l.y-l.height/2}));
    if(!unit)continue;
    const center=unit.x+unit.width/2;
    let baseline=unit.y;
    const parts=[];
    for(let line=0;line<3;line++){
      const matches=labels.filter(l=>l!==unit&&(l.confidence??100)>=85&&
        /^[A-Z][A-Z &.'’–-]{2,}$/i.test(l.text.trim())&&
        !/\b(?:wide|corridor|lobby|shaft|duct|void|stair|lift|AHU|ELEC)\b/i.test(l.text)&&
        l.height>=unit.height*.65&&l.height<=unit.height*1.55&&
        l.y-baseline>=unit.height*.65&&l.y-baseline<=unit.height*1.85&&
        Math.abs(l.x+l.width/2-center)<=unit.height*1.25&&
        owns(room,{x:l.x+l.width/2,y:l.y-l.height/2}));
      if(matches.length!==1)break;
      parts.push(matches[0].text.trim());
      baseline=matches[0].y;
    }
    if(!parts.length||/^(?:shop|store|unit)$/i.test(parts.join(' ')))continue;
    pin.metadata={...pin.metadata,unitNumber:unit.text,needsReview:true};
    pin.name=room.name=[unit.text,...parts].join(' ');
    room.metadata={...room.metadata,labelSource:'Printed storefront caption',needsReview:true};
  }
  const storefrontNames=new Map(rooms.filter(r=>r.metadata?.labelSource==='Printed storefront caption')
    .map(r=>[r.id,r.name]));
  for(const door of result.objects){
    if(door.type==='poi'&&door.category==='Room Door'&&storefrontNames.has(door.metadata?.roomId))
      door.name=storefrontNames.get(door.metadata.roomId);
  }
}
