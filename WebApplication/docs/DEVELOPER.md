Developer guide — coffeegrindsize WebApplication

Scope
- Purpose: developer-facing instructions for building, testing, debugging, and extending the image analysis server.
- Location: `WebApplication/` (server and client). Primary server code lives under `WebApplication/server/src/`.

Prerequisites
- Node.js (v16+ recommended). The project runs Node scripts for tests and the server.
- git, make, and standard dev tools.

Node / JavaScript dev notes
- Server analysis code: `WebApplication/server/src/util/analysis.js`.
  - Key exported function: `analyzeImage(buffer, options)`.
  - Behavior options (passed via `options` or via HTTP form fields):
    - `referenceMode`: 'detected' | 'auto' | 'fixed' (default `detected` in tests). Controls whether to prefer detected diameters or use expected values.
    - `quick`: boolean (true = faster path, less clump splitting; false triggers `breakClump` slow path).
    - Calibration defaults: `expectedOuterDiameterPx`, `expectedInnerDiameterPx`, `outerDiameterMm` (defaults tuned for the target annulus: 93 mm outer/84.5 mm inner).

- `detectAnnulusIterative` is the primary JS-based detector using a radial gradient search.
- `detectAnnulusByRadialProfile` and `detectAnnulusByRadialProfileAvg` are fallback JS detectors.

- `breakClump(cluster, seedIndex, ...)` is a conservative JS implementation used when `quick=false` to split large clusters; it's intended to be safe and fall back to the original cluster if splitting fails.

Debugging and reproduction
- To run the server-side tests (two sample images):

```bash
cd WebApplication
node server/test/analysis_test.mjs
```

- To run the quick=false debug runner (no server required):

```bash
node tmp/run_tests_quickfalse.mjs
```

- To run a single image quickly with detailed debug:

```bash
node tmp/run_single_debug.mjs
# or quick=false
node tmp/run_single_debug_quickfalse.mjs
```

- When running through the HTTP server route, you can enable server stack traces in JSON responses (development only) by setting `SHOW_STACK=1` in the environment before starting the server. The route is in `WebApplication/server/src/routes.js`.

Where debug artifacts go
- The JS analyzer writes `/tmp/analysis_debug_*.json` when `debug` is true; that file contains the full `result` object including debug fields such as `calibration`, `pixelScale`, `detectorUsed`, and `statistics`.

Important fields in the analyzer debug JSON
- `calibration`: { measuredOuterPx, outerDiameterPx, innerDiameterPx, outerDiameterMm, pixelScale }
- `pixelScale`: pixels per mm used for particle size conversion
- `detectorUsed`: one of 'js_radial' | 'radial' | 'avg' | 'box' (what provided center/radii)
- `statistics`: { count, mean, stdDev, mode, D10, D50, D90 }
- `debug.totalThresholded`, `debug.thresholdedInsideInner`: counts of thresholded pixels overall and those inside the inner circle

Testing and CI notes
- The minimal server-side tests are in `WebApplication/server/test/analysis_test.mjs` and exercise the two sample images under `WebApplication/client/src/resources/`.

Developer workflow checklist
- Run the analyzer unit tests: `node server/test/analysis_test.mjs`.
- Use the tmp debug runners for quick iteration.
- If you change `analysis.js`, run the built-in syntax checker (if present) and run the tests.

Common debug tips
- Use `SHOW_STACK=1` to get stack traces in HTTP responses (development only).

Contact / notes
- This document lives under `WebApplication/docs/DEVELOPER.md`.
