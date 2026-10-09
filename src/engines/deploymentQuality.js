export function deploymentQuality({spacingScore=0,coverageScore=0,connectivityScore=0,anchorPlacementScore=0,geometryFailures=0}) {
  const scores={spacingScore,coverageScore,connectivityScore,anchorPlacementScore};
  for(const key of Object.keys(scores))scores[key]=Math.max(0,Math.min(100,Number(scores[key])||0));
  const overallScore=geometryFailures ? 0 : Object.values(scores).reduce((a,b)=>a+b,0)/4;
  const warnings=Object.entries(scores).filter(([,score])=>score<100-1e-6).map(([metric,score])=>({code:"quality-reduction",metric,message:`${metric==="anchorPlacementScore"?"Landmark coverage":metric}: ${score.toFixed(1)}/100. Review related spacing, coverage, connectivity or landmark coverage warnings.`}));
  if(geometryFailures)warnings.push({code:"geometry-quality-failure",message:"Deployment is not geometry-safe; overall quality is capped at zero."});
  return {overallScore,...scores,geometryFailures,warnings};
}
