import React,{useState} from 'react';
import {floorGeojson} from '../models/floorGeojson.js';
import {downloadFile} from '../models/deploymentExport.js';
import {recognizePolygonNames} from '../models/polygonOcr.js';
import profile from '../../venue_profile.json';
export default function ProfessionalExport({project}){
  const [floor,setFloor]=useState(''),[venue,setVenue]=useState(profile.venueType),[controls,setControls]=useState(''),[overrides,setOverrides]=useState('{}'),[routes,setRoutes]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function run(localDiagnostic){setBusy(true);setMessage('');try{
    if(!/^-?\d+$/.test(floor))throw new Error('Enter the actual integer floor number.');
    const scale=Number(project.widthMeters)/Number(project.drawingWidthPixels);if(!(scale>0))throw new Error('Calibrate the drawing scale.');
    const source=floorGeojson({...project,geographicOrigin:null});
    const config={floor:Number(floor),profile:{...JSON.parse(overrides),venueType:venue},metersPerPixel:scale,scaleSource:project.floorAnalysis?.scaleSource||null,localDiagnostic,controlPoints:controls.trim()?JSON.parse(controls):[],graph:project.graph,routing:routes,labels:(project.floorPlanLabels||[]).map(l=>({...l,x:l.x*scale,y:-l.y*scale,width:(l.width||0)*scale,height:(l.height||0)*scale}))};
    const draftResponse=await fetch('/api/professional-annotation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,config:{...config,localDiagnostic:true,routing:false}})});const draft=await draftResponse.json();if(!draftResponse.ok)throw new Error(draft.error);
    setMessage('Retrying OCR on unnamed polygon crops…');config.labels.push(...await recognizePolygonNames(project.floorPlanPreview,draft.annotation,scale,{...profile,...config.profile},{width:project.drawingWidthPixels,height:project.drawingHeightPixels}));
    const response=await fetch('/api/professional-annotation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,config})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Export failed');
    downloadFile(localDiagnostic?'annotation-local-diagnostic.json':'professional-annotation.geojson',JSON.stringify(result.annotation,null,2),'application/json');downloadFile('annotation-report.md',result.report,'text/markdown');if(result.routing)downloadFile('routing-local-metres.json',JSON.stringify(result.routing,null,2),'application/json');
    setMessage(`Validated ${result.annotation.features.length} features. ${Math.round(result.validation.reviewFraction*100)}% require review.${localDiagnostic?' Local diagnostic only; geographic registration unverified.':''}`);
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  return <details><summary>Professional annotation export</summary><label>Venue type<select value={venue} onChange={e=>setVenue(e.target.value)}>{Object.keys(profile.presets).map(t=><option key={t}>{t}</option>)}</select></label><label>Actual floor number<input type="number" step="1" value={floor} onChange={e=>setFloor(e.target.value)}/></label><label>Surveyed control points (JSON)<textarea value={controls} onChange={e=>setControls(e.target.value)} placeholder={'[{"pixel":[100,200],"latitude":28.0,"longitude":77.0}, …]'} /></label><small>Supply at least three points spanning the drawing. Residual error must be ≤3 m. Pixel coordinates use the imported drawing frame.</small><label>Profile overrides (JSON)<textarea value={overrides} onChange={e=>setOverrides(e.target.value)}/></label><label><input type="checkbox" checked={routes} onChange={e=>setRoutes(e.target.checked)}/>Separate routing artifact (local metres)</label><div className="button-row"><button disabled={busy} onClick={()=>run(false)}>Export validated annotation</button><button disabled={busy} onClick={()=>run(true)}>Export local diagnostic</button></div>{message&&<p role="status">{message}</p>}</details>;
}
