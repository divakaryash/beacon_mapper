import test from 'node:test';
import assert from 'node:assert/strict';
import {iwayRequest} from './iwayApi.js';

test('iway client selects the environment, uses building IDs, and rejects bad responses', async t => {
  const calls = [];
  const methods = [];
  let payload = [{_id: '6a4b97a1f02e0d2d7f5c43cb', venueName: 'Venue', buildingName: 'Building'}];
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    methods.push(options.method);
    calls.push(new URL(url));
    return new Response(JSON.stringify(payload), {status});
  });
  assert.equal((await iwayRequest('dev', 'test key'))[0].buildingName, 'Building');
  assert.equal(calls[0].origin, 'https://dev.iwayplus.in');
  assert.equal(calls[0].pathname, '/secured/building/all');
  assert.equal(calls[0].searchParams.get('api_key'), 'test key');
  payload = {mappingElements: [], masterGraph: {}};
  assert.deepEqual(await iwayRequest('maps', 'maps-key', '6a4b97a1f02e0d2d7f5c43cb'), payload);
  assert.equal(calls[1].origin, 'https://maps.iwayplus.in');
  assert.equal(calls[1].pathname, '/secured/get-global-annotation/6a4b97a1f02e0d2d7f5c43cb');
  payload = {message: 'Internal Servel Error'};
  await assert.rejects(iwayRequest('dev', 'key'), /valid building list/);
  status = 401;
  await assert.rejects(iwayRequest('dev', 'key'), /401/);
  await assert.rejects(iwayRequest('other', 'key'), /API key/);
  await assert.rejects(iwayRequest('dev', ''), /API key/);
  await assert.rejects(iwayRequest('dev', 'key', '../bad'), /building ID/);
  assert.equal(calls.length, 4);
  assert.deepEqual(methods, ['POST', 'GET', 'POST', 'POST']);
});
