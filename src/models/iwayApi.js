export const IWAY_ENVIRONMENTS = {
  dev: { label: 'Dev', origin: 'https://dev.iwayplus.in' },
  maps: { label: 'Maps', origin: 'https://maps.iwayplus.in' },
};
export async function iwayRequest(environment, apiKey, buildingId, signal) {
  const config = IWAY_ENVIRONMENTS[environment];
  if (!config || !apiKey?.trim())
    throw new Error('Enter an API key for the selected environment.');
  if (buildingId !== undefined && !/^[a-f\d]{24}$/i.test(buildingId))
    throw new Error('Invalid building ID.');
  const url = new URL(buildingId === undefined ? '/secured/building/all' : `/secured/get-global-annotation/${buildingId}`, config.origin);
  url.searchParams.set('api_key', apiKey.trim());
  let response;
  try {
    response = await fetch(url, { method: buildingId === undefined ? 'POST' : 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  }
  catch (error) {
    if (error.name === 'AbortError')
      throw error;
    throw new Error('Could not reach the API. Check your connection and the server’s browser access (CORS) settings.');
  }
  if (!response.ok)
    throw new Error(`API request failed (${response.status}).`);
  let payload;
  try {
    payload = await response.json();
  }
  catch {
    throw new Error('The API returned invalid JSON.');
  }
  if (buildingId !== undefined)
    return payload;
  const buildings = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(buildings) || buildings.some(b => !b || typeof b._id !== 'string' || !/^[a-f\d]{24}$/i.test(b._id) || typeof b.venueName !== 'string' || typeof b.buildingName !== 'string')) {
    throw new Error('The API did not return a valid building list. Please retry.');
  }
  return buildings;
}
