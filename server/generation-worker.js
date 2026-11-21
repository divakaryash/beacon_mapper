import { parentPort, workerData } from 'node:worker_threads';
import { generateData } from './generation.js';
import { generateBuildingData } from './building-generation.js';
try {
  const result = workerData.action === 'generateBuilding'
    ? generateBuildingData(workerData.request)
    : generateData(workerData.request);
  parentPort.postMessage({ result });
}
catch (error) {
  parentPort.postMessage({ error: error.message });
}
