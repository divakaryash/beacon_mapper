# Beacon generation API

The standalone API runs the same `DeploymentPlanner` and annotation importer as the app. The UI and its existing API imports are unchanged. Requests are independent: no server-side project storage, no changes to your saved browser project, and no calls to iway servers. Send the annotation data your other tool has already fetched.

## Start

From this repository, with Node.js 22.18+ and dependencies installed:

```sh
npm install
npm run api
```

Default URL: `http://127.0.0.1:3001`. The web app can run separately using `npm run dev`.

Configure `.env` and restart the API after changes:

```dotenv
PLANNER_API_HOST=127.0.0.1
PLANNER_API_PORT=3001
PLANNER_API_KEY=replace-with-your-own-random-token
PLANNER_API_CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

`PLANNER_API_KEY` is a separate token for this service. `Dev_Api_Key` and `Maps_Api_Key` keep their existing purpose and are not required by generation. Local use can omit the service token. Binding to a network interface such as `0.0.0.0` requires a token. For remote use, serve through your HTTPS backend or reverse proxy. Keep the service token in your other project's backend when it must remain private. Browser CORS origins must exactly match scheme, hostname and port; native/backend clients do not require CORS.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/v1/health` | `{ "status": "ok", "apiVersion": "1" }` |
| POST | `/api/v1/generate` | Beacon plan, coverage, effective settings and work metrics |

Generation requires `Content-Type: application/json` and, when configured, `Authorization: Bearer YOUR_TOKEN`. Health and OPTIONS preflight do not require authentication.

### Generate from annotation JSON

```js
const response = await fetch('http://127.0.0.1:3001/api/v1/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PLANNER_API_KEY}`,
  },
  body: JSON.stringify({
    annotations: annotationPayload, // Same JSON accepted by the app's annotation import
    floor: '0',                     // Required; generate one selected floor per request
    // waypoints: waypointPayload,  // Optional separate waypoint JSON
    // settings: { reliableRadius: 6, marginalRadius: 8 },
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.plan.beacons, data.coverage);
```

Use the example from a backend environment with `process.env`, or adapt the token configuration to your client. The API returns actual generation output; it does not merely echo the input's annotated beacon positions.

### Generate from a project

Send `{ "project": projectData }` using the app's project JSON (including `graph`, `objects`, metric dimensions, and drawing pixel dimensions), or the app's exported deployment JSON (`schemaVersion: 1`, `geometry`, `scale`, `deployment`). Existing project profiles, settings and beacons are passed to the planner exactly as in the UI. Optional top-level `settings` override project settings for this request.

Try the included hand-modelled sample:

```sh
curl http://127.0.0.1:3001/api/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --data-binary @examples/generation-request.json
```

### Generate from engine inputs

For projects with their own graph and geometry pipeline, send:

```js
{
  inputs: {
    graph: { nodes, edges },
    floorGeometry,
    // profiles, settings, beacons, pois: optional existing engine inputs
  },
  // settings: optional overrides
}
```

Provide exactly one of `annotations`, `project` or `inputs`. Graph nodes require unique IDs, `floorId`, drawing coordinates `x` / `y` and metric `worldX` / `worldY`. Edges reference node IDs with `source` / `target` and require unique IDs and metric distances. Use the existing engine's geometry schema; for direct metric polygons it supports `floorGeometry: { floors: [{ floorId, boundaries: [[{x,y}, ...]], walkableAreas: [[{x,y}, ...]] }] }`. Project inputs convert drawing coordinates using the calibrated scale. Invalid or missing walkable geometry fails validation instead of producing fabricated placements.

## Response

The response contains the existing planner output plus `apiVersion: "1"`:

| Field | Meaning |
| --- | --- |
| `plan.beacons` | Generated IDs, floor, drawing and metric coordinates, `latitude`, `longitude`, radii, enabled state and placement metadata |
| `plan.statistics`, `plan.warnings`, `plan.quality` | Existing deployment statistics, warnings and quality checks |
| `coverage` | Existing coverage engine output, including graph segments, gaps, per-floor area samples, coverage percentages and warnings |
| `settings` | Effective validated generation settings |
| `work`, `scale` | Existing engine work metrics and drawing scale |

Use each beacon's `worldX` / `worldY` for metric positioning and `x` / `y` for the tool's drawing coordinates. Coverage describes geometric radius/visibility estimates, not measured Bluetooth signal strength. Floor samples and graph segments allow your other tool to reproduce the overlay.

## Limits and errors

Error responses are `{ "error": "message" }`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed JSON |
| 401 | Missing or incorrect configured token |
| 403 | Browser origin not allowed |
| 404 / 405 | Unknown route / incorrect method |
| 413 / 415 | Input over 15 MB / incorrect content type |
| 422 | Invalid generation input, settings or geometry |
| 503 | Two generation requests already active; retry later |
| 504 | Generation exceeded 120 seconds |
| 500 | Worker or server failure |

Uploads have a 30-second idle timeout. CPU work runs in a separate worker per request, with at most two active requests and a 120-second generation timeout. The service is synchronous: wait for the JSON response, and do not automatically retry invalid inputs. No generated files or test files are created by the service.

## Beacon latitude and longitude

Each entry in `plan.beacons` includes `latitude` and `longitude` in WGS84 decimal degrees. Annotation requests use the imported geographic alignment automatically; no additional body fields are needed. Georeferenced projects use the same conversion as the app's GeoJSON export. New deployment exports preserve their geographic alignment.

For engine inputs or older project exports that contain only local coordinates, optionally add a top-level origin:

```js
{
  inputs: { graph, floorGeometry },
  geographicOrigin: { latitude: 28.0, longitude: 77.0 }
}
```

The origin is the geographic position of local `(worldX: 0, worldY: 0)`. This fallback assumes X increases eastward and Y increases southward; it does not model a rotated coordinate frame. A project's own geographic origin/alignment takes precedence. Without any geographic reference, both fields are `null` and `georeferencing.available` is `false`; local coordinates are never presented as latitude/longitude.

```json
{
  "id": "IW001",
  "latitude": 28.0001,
  "longitude": 77.0002
}
```

The snippet illustrates the added fields on a beacon; all existing beacon fields remain in the response. Read `georeferencing.source` to see whether an annotation alignment or geographic origin was used.
