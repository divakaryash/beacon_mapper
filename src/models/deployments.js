export function geometryForProject(project) {
  const scale=Number(project.widthMeters)/Number(project.drawingWidthPixels);
  if(!Number.isFinite(scale)||scale<=0)throw new Error("Calibrate the drawing scale first.");
  if(Number(project.heightMeters)>0&&Number(project.drawingHeightPixels)>0&&Math.abs(Number(project.heightMeters)/Number(project.drawingHeightPixels)-scale)>scale*.001)throw new Error("Width and height imply different drawing scales. Correct the dimensions before deployment.");
  if(project.graph.nodes.some(n=>Math.abs(n.x*scale-n.worldX)>.001||Math.abs(n.y*scale-n.worldY)>.001))throw new Error("Drawing scale and graph coordinates disagree. Regenerate/review the graph before deployment.");
  return {objects:project.objects,metersPerPixel:scale,defaultFloorId:project.graph.nodes[0]?.floorId||"floor-1"};
}
export function deploymentInputSignature(project) {
  const text=JSON.stringify([project.graph,project.objects,project.widthMeters,project.heightMeters,project.drawingWidthPixels,project.drawingHeightPixels]);
  let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return (hash>>>0).toString(16);
}
import {coverageSummary} from "./deploymentExport.js";
export function saveDeployment(project,name,id=crypto.randomUUID()) {
  if(!project.beaconPlan)throw new Error("Generate or insert beacons before saving a deployment.");
  if(!name.trim())throw new Error("Deployment name is required.");
  const snapshot={id,name:name.trim(),savedAt:new Date().toISOString(),plan:structuredClone(project.beaconPlan),profile:structuredClone(project.beaconProfile),settings:structuredClone(project.planningSettings),coverage:structuredClone(coverageSummary(project.coverageAnalysis)),inputSignature:deploymentInputSignature(project)};
  return {...project,deployments:[...(project.deployments||[]).filter(d=>d.id!==id),snapshot],activeDeploymentId:id};
}
export function loadDeployment(project,id) {
  const saved=(project.deployments||[]).find(d=>d.id===id);if(!saved)throw new Error("Deployment not found.");
  return {...project,beaconPlan:structuredClone(saved.plan),beaconProfile:structuredClone(saved.profile),planningSettings:{...structuredClone(saved.settings),beaconPrefix:project.planningSettings?.beaconPrefix||saved.settings?.beaconPrefix||"IW",nextBeaconNumber:Math.max(project.planningSettings?.nextBeaconNumber||1,saved.settings?.nextBeaconNumber||1)},activeDeploymentId:id,coverageAnalysis:null,placementNeedsReview:!saved.plan.geometryValidation||saved.inputSignature!==deploymentInputSignature(project)};
}
export function duplicateDeployment(project,id) {
  const saved=(project.deployments||[]).find(d=>d.id===id);if(!saved)throw new Error("Deployment not found.");
  return {...project,deployments:[...(project.deployments||[]),{...structuredClone(saved),id:crypto.randomUUID(),name:`${saved.name} copy`,savedAt:new Date().toISOString()}]};
}
export function deleteDeployment(project,id) {
  return {...project,deployments:(project.deployments||[]).filter(d=>d.id!==id),activeDeploymentId:project.activeDeploymentId===id?null:project.activeDeploymentId};
}
