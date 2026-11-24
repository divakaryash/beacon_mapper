import profile from '../../venue_profile.json' with {type:'json'};
import {destinationCategory} from './destinationCategory.js';

const floorTypes = new Set(['Boundary','Walkable Area','Public floor','Void','Restricted Area','Non Walkable','Green Area','Vertical circulation','Stairs','Steps','Escalator']);
// Category fill colors sampled from the hospital reference polygons.
const colors = {...profile.colors, Room:'#a4d3df', Consultation:'#a4d3df', Store:'#a4d3df',
  'Walkable Area':'#ffffff','Public floor':'#ffffff',Lobby:'#ffffff',Parking:'#ffffff',Ramp:'#ffffff',
  Wall:'#767676',Lift:'#474747',Stairs:'#ada4a4',Steps:'#ada4a4',Escalator:'#666666',
  'Vertical circulation':'#666666',Washroom:'#8fdb88','Male Washroom':'#8fdb88','Female Washroom':'#8fdb88',
  'Restricted Area':'#dd8888','Non Walkable':'#dd8888',Void:'#dd8888',Pharmacy:'#959bee',
  Reception:'#e5cccc','Registration Area':'#e5cccc','Nurse station':'#e5cccc','Nurse Station':'#e5cccc',Counter:'#e5cccc',
  'Food Court':'#d8f3dc',Cafeteria:'#d8f3dc',ATM:'#af79a0',Beam:'#a4d3df',Piller:'#c9c0c0',Pillar:'#c9c0c0',
  'Accessible Washroom':'#8fdb88','Unisex Washroom':'#8fdb88','Green Area':'#7bc76e'};

export function pinColor(type){
  if(['Lift','Escalator'].includes(type))return '#31577e';
  if(['Stairs','Steps'].includes(type))return '#efa600';
  if(/washroom/i.test(type))return '#2497d5';
  if(['Entrance','Exit'].includes(type))return '#52ac66';
  return '#22b8b6';
}
const types = {buildingBoundary:'Boundary',walkableArea:'Walkable Area',restrictedArea:'Restricted Area',nonWalkableArea:'Non Walkable',wall:'Wall',room:'Room',rectangle:'Room',polygon:'Room'};

export function polygonAppearance(object){
  const category=object.category || object.metadata?.sourceType || types[object.type];
  if(!types[object.type])return null;
  const roomFloor=object.type==='room'&&!['Lift','Wall','Beam','Restricted Area'].includes(category);
  const flat=roomFloor||floorTypes.has(category)||object.type==='walkableArea'||object.type==='buildingBoundary';
  const specified=Number.isFinite(object.extrusionMeters)&&object.extrusionMeters>=0;
  const height=specified?object.extrusionMeters:flat?0:category==='Beam'?1:Number(profile.defaultHeight);
  const use=object.type==='room'&&['Room','Store'].includes(category)?destinationCategory(object.name):null;
  return {height,heightSource:specified?(object.extrusionSource||'user'):'assumed',
    fillColor:object.fillColor||(category==='Wall'&&object.metadata?.wallRole==='room partition'?colors.Room:null)||colors[use]||colors[category]||colors[types[object.type]]||colors.Room};
}
