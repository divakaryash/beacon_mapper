import { IWAY_ENVIRONMENTS } from '../src/models/iwayApi.js';
import { annotationFloors } from '../src/models/annotatedFloor.js';
import { generateData } from './generation.js';

const MAX_ANNOTATION_BYTES = 15_000_000;

function apiError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Resolve credentials on the server; callers never supply an upstream URL or key.
export async function fetchBuildingAnnotations(body, apiKeys, fetchRequest = fetch) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw apiError(400, 'A JSON object is required.');
  }

  const buildingId = body.buildingId ?? body.buildingID;
  const environment = body.environment ?? 'dev';

  if (typeof buildingId !== 'string' || !/^[a-f\d]{24}$/i.test(buildingId)) {
    throw apiError(400, 'buildingId must be a 24-character hexadecimal ID.');
  }
  if (!['dev', 'maps'].includes(environment)) {
    throw apiError(400, 'environment must be dev or maps.');
  }
  if (body.floor !== undefined && (
    !['string', 'number'].includes(typeof body.floor) ||
    String(body.floor).trim() === '' || !Number.isFinite(Number(body.floor))
  )) {
    throw apiError(400, 'floor must be a numeric floor number.');
  }
  if (body.settings !== undefined && (
    !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)
  )) {
    throw apiError(400, 'settings must be a JSON object.');
  }

  const apiKey = apiKeys[environment]?.trim();
  if (!apiKey) {
    throw apiError(503, `No upstream API key configured for ${environment}. Set ${environment === 'dev' ? 'Dev_Api_Key' : 'Maps_Api_Key'} on the server.`);
  }

  const url = new URL(
    `/secured/get-global-annotation/${buildingId}`,
    IWAY_ENVIRONMENTS[environment].origin,
  );
  url.searchParams.set('api_key', apiKey);

  let payload;
  try {
    const response = await fetchRequest(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw apiError(502, `Global annotation API returned HTTP ${response.status}.`);
    }

    // Bound both downloading and JSON parsing without exposing upstream error bodies.
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_ANNOTATION_BYTES) {
        throw apiError(502, 'Global annotation response exceeds 15 MB.');
      }
      chunks.push(Buffer.from(chunk));
    }
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw apiError(504, 'Global annotation API timed out.');
    }
    throw apiError(502, 'Could not fetch valid JSON from the global annotation API.');
  }

  // Accept a direct API payload or a data-wrapped payload, keeping masterGraph intact.
  const annotations = payload?.data?.mappingElements ? payload.data : payload;
  if (!Array.isArray(annotations?.mappingElements) || !annotations.mappingElements.length) {
    throw apiError(502, 'Global annotation response must contain nonempty mappingElements.');
  }

  return {
    buildingId,
    environment,
    annotations,
    ...(body.floor !== undefined ? { floor: String(body.floor) } : {}),
    ...(body.settings !== undefined ? { settings: body.settings } : {}),
  };
}

// Run inside the generation worker so multi-floor planning cannot block HTTP requests.
export function generateBuildingData(request) {
  const availableFloors = annotationFloors(request.annotations).floors;
  const selectedFloors = request.floor === undefined ? availableFloors : [request.floor];

  if (selectedFloors.some(floor => !availableFloors.includes(floor))) {
    throw new Error(`Requested floor was not found. Available floors: ${availableFloors.join(', ')}.`);
  }

  const floors = selectedFloors.map(floor => ({
    floor,
    ...generateData({
      annotations: request.annotations,
      floor,
      settings: request.settings,
    }),
  }));

  return {
    apiVersion: '1',
    buildingId: request.buildingId,
    environment: request.environment,
    floors,
    // The explicit source floor disambiguates beacon IDs reused on different floors.
    beacons: floors.flatMap(result => result.plan.beacons.map(beacon => ({
      ...beacon,
      floor: result.floor,
    }))),
  };
}
