import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
export function createGenerationServer({ apiKey = '', allowedOrigins = [], timeoutMs = 120000, maxBodyBytes = 15000000, maxConcurrent = 2 } = {}) {
  let active = 0;
  return createServer(async (req, res) => {
    const send = (status, payload) => {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(payload));
      }
    };
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!['/api/v1/health', '/api/v1/generate'].includes(pathname))
      return send(404, { error: 'Not found.' });
    if (req.headers.origin) {
      if (!allowedOrigins.includes(req.headers.origin))
        return send(403, { error: 'Origin not allowed. Configure PLANNER_API_CORS_ORIGINS.' });
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (pathname === '/api/v1/health') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(405, { error: 'GET required.' });
      }
      return send(200, { status: 'ok', apiVersion: '1' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(405, { error: 'POST required.' });
    }
    if (apiKey) {
      const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${apiKey}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return send(401, { error: 'Invalid API token.' });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
      return send(415, { error: 'Content-Type must be application/json.' });
    if (active >= maxConcurrent)
      return send(503, { error: 'Generation capacity reached. Retry later.' });
    active++;
    let worker, timer;
    try {
      let size = 0;
      const chunks = [];
      // Bound slow request uploads as well as generation time.
      req.setTimeout(30000, () => req.destroy());
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBodyBytes)
          return send(413, { error: 'Input exceeds 15 MB.' });
        chunks.push(chunk);
      }
      req.setTimeout(0);
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      catch {
        return send(400, { error: 'Invalid JSON.' });
      }
      const message = await new Promise((resolve, reject) => {
        worker = new Worker(new URL('./generation-worker.js', import.meta.url), { workerData: body });
        timer = setTimeout(() => reject(Object.assign(new Error('Generation timed out.'), { status: 504 })), timeoutMs);
        worker.once('message', resolve);
        worker.once('error', () => reject(new Error('Generation worker failed.')));
        worker.once('exit', code => {
          if (code !== 0)
            reject(new Error('Generation worker stopped.'));
        });
      });
      return message.error ? send(422, { error: message.error }) : send(200, message.result);
    }
    catch (error) {
      return send(error.status || 500, { error: error.message });
    }
    finally {
      clearTimeout(timer);
      if (worker)
        await worker.terminate();
      active--;
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''), ...process.env };
  const port = Number(env.PLANNER_API_PORT || 3001), host = env.PLANNER_API_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PLANNER_API_PORT.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !env.PLANNER_API_KEY)
    throw new Error('Set PLANNER_API_KEY before exposing the API on a network interface.');
  const server = createGenerationServer({ apiKey: env.PLANNER_API_KEY, allowedOrigins: (env.PLANNER_API_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean) });
  server.listen(port, host, () => console.log(`Planner API listening on http://${host}:${port}`));
}
