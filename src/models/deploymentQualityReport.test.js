import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentQualityReport} from './deploymentExport.js';

test('failed imports export their source and detection error without fabricating coverage',()=>{
  const report=deploymentQualityReport({name:'L00.pdf',objects:[],graph:{nodes:[],edges:[]},floorAnalysis:{status:'failed',warnings:['No enclosed regions']}});
  assert.equal(report.status,'analysis-failed');
  assert.equal(report.source.filename,'L00.pdf');
  assert.equal(report.beaconCount,0);
  assert.deepEqual(report.inputs,{objects:0,nodes:0,edges:0});
  assert.deepEqual(report.floorAnalysis.warnings,['No enclosed regions']);
  assert.equal(report.coveragePercentage,undefined);
});

test('generated reports include floor identity, counts and compact coverage without raster cells',()=>{
  const report=deploymentQualityReport({objects:[{}],graph:{nodes:[{}],edges:[{}]},floorAnalysis:{referenceFloor:-1},beaconPlan:{beacons:[{id:'IW001'}],warnings:[]},coverageAnalysis:{totalArea:20,floorReports:[{floorId:'floor-1',cells:[1]}]}});
  assert.equal(report.status,'draft-generated');
  assert.equal(report.floorAnalysis.referenceFloor,-1);
  assert.equal(report.beaconCount,1);
  assert.equal(report.totalArea,20);
  assert.deepEqual(report.floors,[{floorId:'floor-1'}]);
});
