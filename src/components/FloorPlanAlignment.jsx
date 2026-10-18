import React from 'react';
import {createFloorPlanOverlay} from '../models/floorPlanOverlay.js';

export default function FloorPlanAlignment({project,update,tool,setTool}){
  const overlay=project.floorPlanOverlay;
  if(!overlay)return null;
  const change=patch=>update({...project,floorPlanOverlay:{...overlay,...patch}});
  return <section className="panel-section" aria-label="Manual floor plan alignment">
    <h2>Step 2 · Align floor plan</h2>
    <p>GeoJSON stays fixed. Drag the image, or use the controls below. Generate placement only when you are ready.</p>
    <button type="button" className={tool==='alignMap'?'active':''} onClick={()=>setTool(tool==='alignMap'?'select':'alignMap')}>{tool==='alignMap'?'Finish alignment':'Drag floor plan'}</button>
    <div className="field-grid">{[['x','Position X (px)'],['y','Position Y (px)'],['rotation','Rotation (°)'],['scale','Uniform scale']].map(([key,label])=><label key={key}>{label}<input type="number" step={key==='scale'?'.01':'1'} min={key==='scale'?'.001':undefined} value={overlay[key]} onChange={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)&&(key!=='scale'||value>=.001))change({[key]:value});}}/></label>)}</div>
    <label>Floor plan opacity · {Math.round(overlay.opacity*100)}%<input type="range" min="0" max="1" step=".01" value={overlay.opacity} onChange={e=>change({opacity:Number(e.target.value)})}/></label>
    <div className="button-row"><button type="button" aria-pressed={overlay.flipX} onClick={()=>change({flipX:!overlay.flipX})}>Flip horizontally</button><button type="button" aria-pressed={overlay.flipY} onClick={()=>change({flipY:!overlay.flipY})}>Flip vertically</button></div>
    <label className="check-label"><input type="checkbox" checked={overlay.geojsonVisible} onChange={e=>change({geojsonVisible:e.target.checked})}/>Show GeoJSON</label>
    <label className="check-label"><input type="checkbox" checked={overlay.snap} onChange={e=>change({snap:e.target.checked})}/>Snap image corners / center to GeoJSON vertices and POIs</label>
    <small>Wheel to zoom · Space-drag to pan. Corner handles resize uniformly; the round handle rotates. Undo restores each completed drag.</small>
    <button type="button" onClick={()=>update({...project,floorPlanOverlay:createFloorPlanOverlay(overlay.width,overlay.height,project.drawingWidthPixels,project.drawingHeightPixels)})}>Reset image alignment</button>
  </section>;
}
