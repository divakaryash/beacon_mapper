import {BEACON_PROFILES} from "../engines/beaconPlacement.js";
export function coverageSummary(result) {
  if(!result)return null;
  const {floorReports,...summary}=result;
  return {...summary,floors:floorReports.map(({cells,...floor})=>floor)};
}
export function deploymentQualityReport(project) {
  return {
    ...coverageSummary(project.coverageAnalysis),
    reportVersion:2,
    status:project.floorAnalysis?.status==="failed"||project.deploymentError?"analysis-failed":project.beaconPlan?.beacons.length?"draft-generated":"not-generated",
    source:{filename:project.file?.name||project.name,sha256:project.sourceSha256,drawingWidthPixels:project.drawingWidthPixels,drawingHeightPixels:project.drawingHeightPixels},
    floorAnalysis:project.floorAnalysis||null,
    deploymentError:project.deploymentError||null,
    inputs:{objects:project.objects.length,nodes:project.graph.nodes.length,edges:project.graph.edges.length},
    beaconCount:project.beaconPlan?.beacons.length||0,
    placementWarnings:project.beaconPlan?.warnings||[],
  };
}
export function deploymentDocument(project) {
  if(!project.beaconPlan||project.placementNeedsReview)throw new Error("Recalculate a valid deployment before exporting.");
  return {schemaVersion:1,name:project.name,exportedAt:new Date().toISOString(),units:"metres",coordinateUnits:{worldX:"metres",worldY:"metres",x:"drawing pixels",y:"drawing pixels",geometry:"drawing pixels; thicknessMeters/widthMeters are metres"},isRFSimulation:false,planningSettings:project.planningSettings,profiles:[...BEACON_PROFILES,...(project.beaconProfiles||[])],graph:project.graph,geometry:project.objects,scale:{widthMeters:project.widthMeters,heightMeters:project.heightMeters,drawingWidthPixels:project.drawingWidthPixels,drawingHeightPixels:project.drawingHeightPixels},deployment:project.beaconPlan,coverage:coverageSummary(project.coverageAnalysis)};
}
export function beaconCsv(beacons) {
  const fields=["id","floorId","type","profileId","enabled","locked","worldX","worldY","installationType","mountingHeight","orientation","coverageRadius","reliableRadius","marginalRadius","edgeId","edgeOffset","nodeId","referenceDistance","placementStrategy","placementRole","installationStatus","notes"];
  // Text that spreadsheet software might execute is exported as literal text.
  const cell=value=>{let text=String(value??"");if(typeof value==="string"&&/^[=+@\-\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  return [fields.map(cell).join(","),...beacons.map(b=>fields.map(f=>cell(b[f])).join(","))].join("\r\n");
}
export function versionMetrics(version) {
  const coverage=version.coverage,stats=version.plan.statistics;
  return {beacons:version.plan.beacons.length,activeBeacons:stats.activeBeacons??stats.totalBeacons,coverage:coverage?.coveragePercentage??null,deadZone:coverage?.totalArea?100*coverage.deadZoneArea/coverage.totalArea:null,overlap:coverage?.overlapPercentage??null,averageSpacing:stats.averageSpacing,quality:coverage?.quality?.overallScore??version.plan.quality?.overallScore??null,cost:stats.installationCost??null};
}
export function compareDeployments(a,b) {
  const first=versionMetrics(a),second=versionMetrics(b);
  const sameAssumptions=JSON.stringify([a.coverage?.coverageThreshold,a.coverage?.resolution])===JSON.stringify([b.coverage?.coverageThreshold,b.coverage?.resolution]);
  const sameCurrency=(a.settings?.currency||"INR")===(b.settings?.currency||"INR");
  return {sameGeometry:a.inputSignature===b.inputSignature,sameAssumptions,sameCurrency,rows:Object.keys(first).map(metric=>({metric,a:first[metric],b:second[metric],delta:first[metric]!==null&&second[metric]!==null&&(metric!=="cost"||sameCurrency)?second[metric]-first[metric]:null}))};
}

export function downloadFile(name,data,type="application/json") {
  const url=URL.createObjectURL(data instanceof Blob?data:new Blob([typeof data==="string"?data:JSON.stringify(data,null,2)],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function exportCanvasPng(svg) {
  if(!svg)throw new Error("Planning canvas not available.");
  const clone=svg.cloneNode(true),box=svg.getBoundingClientRect();clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width",String(box.width));clone.setAttribute("height",String(box.height));
  // Embed the existing styles so the standalone SVG raster has the same graph/room styling.
  const style=document.createElementNS("http://www.w3.org/2000/svg","style");style.textContent=[...document.styleSheets].map(sheet=>{try{return [...sheet.cssRules].map(r=>r.cssText).join("\n");}catch{return "";}}).join("\n");clone.prepend(style);
  for(const image of clone.querySelectorAll("image")){const href=image.getAttribute("href");if(href?.startsWith("blob:")){const blob=await(await fetch(href)).blob();image.setAttribute("href",await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);}));}}
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml"}));
  try {
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("Canvas screenshot could not be rendered."));image.src=url;});
    const canvas=document.createElement("canvas");canvas.width=Math.ceil(box.width*2);canvas.height=Math.ceil(box.height*2);canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("PNG export failed.")),"image/png"));downloadFile("deployment-screenshot.png",blob);
  } finally {URL.revokeObjectURL(url);}
}
