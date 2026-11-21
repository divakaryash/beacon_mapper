import {parentPort, workerData} from 'node:worker_threads';
import {generateData} from './generation.js';
try { parentPort.postMessage({result: generateData(workerData)}); }
catch (error) { parentPort.postMessage({error: error.message}); }
