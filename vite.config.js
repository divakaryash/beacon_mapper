import {annotationService} from './scripts/annotation-service.mjs';
import {defineConfig} from 'vite';
import {createReadStream} from 'node:fs';
import {copyFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';

// Serve the same bundled OCR assets in development and production, without CDN requests.
export default defineConfig({plugins:[annotationService(),{
  name:'local-ocr-assets',
  async configureServer(server){
    const assets=await ocrAssets();
    server.middlewares.use((request,response,next)=>{
      const file=assets.get(request.url?.split('?')[0]);if(!file)return next();
      response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');
      createReadStream(file).on('error',()=>{response.statusCode=404;response.end();}).pipe(response);
    });
  },
  async writeBundle(options){
    const folder=path.resolve(options.dir||'dist','ocr');await mkdir(folder,{recursive:true});
    for(const [url,file] of await ocrAssets())await copyFile(file,path.join(folder,path.basename(url)));
  }
}]});
async function ocrAssets(){
  const core=path.resolve('node_modules/tesseract.js-core');
  const assets=new Map([['/ocr/worker.min.js',path.resolve('node_modules/tesseract.js/dist/worker.min.js')],['/ocr/eng.traineddata.gz',path.resolve('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz')]]);
  for(const name of await readdir(core))if(name.endsWith('.wasm.js')||name.endsWith('.wasm'))assets.set('/ocr/'+name,path.join(core,name));
  return assets;
}
