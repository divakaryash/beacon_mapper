export function validateFloorPlanSetup(values){
  const result={};
  for(const key of ['latitude','longitude','widthMeters','heightMeters']){
    if(String(values[key]??'').trim()===''||!Number.isFinite(Number(values[key])))throw new Error('Enter latitude, longitude, width and height before choosing the floor plan.');
    result[key]=Number(values[key]);
  }
  if(Math.abs(result.latitude)>=89.9||Math.abs(result.longitude)>180)throw new Error('Latitude must be between -89.9 and 89.9; longitude between -180 and 180.');
  if(result.widthMeters<=0||result.heightMeters<=0)throw new Error('Floor-plan dimensions must be positive metres.');
  return result;
}

export function localToGeographic(point,origin){
  const radians=Math.PI/180,radius=6378137;
  const latitude=origin.latitude+point.y/radius/radians;
  const longitude=origin.longitude+point.x/(radius*Math.cos(origin.latitude*radians))/radians;
  if(Math.abs(latitude)>90)throw new Error('Drawing extends beyond valid geographic latitude.');
  return [((longitude+180)%360+360)%360-180,latitude];
}
