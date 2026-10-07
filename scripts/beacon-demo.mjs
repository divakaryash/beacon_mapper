import {planBeacons} from "../src/engines/beaconPlacement.js";
import {sampleMall} from "../src/samples/sampleMall.js";
import {geometryForProject} from "../src/models/deployments.js";
const result=planBeacons({graph:sampleMall.graph,floorGeometry:geometryForProject(sampleMall)});
console.log(JSON.stringify({source:"Hand-modelled Milestone 2 sample mall; not a surveyed floor",statistics:result.statistics,quality:result.quality,coverage:result.coverage.estimatedPercent,anchors:result.beacons.filter(b=>b.type==="Anchor").map(b=>b.nodeId),warnings:result.warnings},null,2));
