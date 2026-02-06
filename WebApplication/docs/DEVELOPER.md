Developer guide — coffeegrindsize WebApplication

Scope
- Purpose: developer-facing instructions for building, testing, debugging, and extending the image analysis server and Hough helper.
- Location: `WebApplication/` (server and client). Primary server code lives under `WebApplication/server/src/`.

Prerequisites
- Node.js (v16+ recommended). The project runs Node scripts for tests and the server.
- Python 3.10+ for the Hough helper; `opencv-python-headless` is used in the helper virtualenv.
- git, make, and standard dev tools.

Python Hough helper (venv)
1. Create and activate a virtualenv for Hough helper (recommended name: `venv_hough`):

```bash
cd WebApplication/server
python3 -m venv venv_hough
source venv_hough/bin/activate
```

2. Install required Python packages (opencv headless + numpy):

```bash
pip install --upgrade pip
pip install opencv-python-headless numpy
```

3. Quick smoke test for cv2 availability:

```bash
python -c "import cv2; print('cv2', cv2.__version__)"
```

Hough helper location
- Script: `WebApplication/server/util/hough_detect.py` — this script downsamples an image (if needed), runs OpenCV HoughCircles, and prints a JSON result (also writes `/tmp/hough_result_*.json`).
- If you tune parameters, you can update default values in that file or call from Node with custom arguments.

Node / JavaScript dev notes
- Server analysis code: `WebApplication/server/src/util/analysis.js`.
  - Key exported function: `analyzeImage(buffer, options)`.
  - Behavior options (passed via `options` or via HTTP form fields):
    - `referenceMode`: 'detected' | 'auto' | 'fixed' (default `detected` in tests). Controls whether to prefer detected diameters or use expected values.
    - `quick`: boolean (true = faster path, less clump splitting; false triggers `breakClump` slow path).
    - Hough-related overrides: `houghDp`, `houghParam1`, `houghParam2`, `houghDownsample`, `houghMinRadius`, `houghMaxRadius`.
    - Calibration defaults: `expectedOuterDiameterPx`, `expectedInnerDiameterPx`, `outerDiameterMm` (defaults tuned for the target annulus: 93 mm outer/84.5 mm inner).

- Hough invocation: `runHoughDetect(buffer, options)` tries multiple parameter candidates and calls the Python helper; it extracts JSON robustly from helper stdout and returns `{ center: {x,y}, diameterPixels, innerDiameterPixels, raw, helper, inputFile }` or `null`.

- `breakClump(cluster, seedIndex, ...)` is a conservative JS implementation used when `quick=false` to split large clusters; it's intended to be safe and fall back to the original cluster if splitting fails.

Debugging and reproduction
- To run the server-side tests (two sample images) and require Hough detection:

```bash
cd /path/to/coffeegrindsize/WebApplication
HOUGH_DEBUG=1 REQUIRE_HOUGH=1 node server/test/analysis_test.mjs
```

- To run the quick=false debug runner (no server required):

```bash
HOUGH_DEBUG=1 node tmp/run_tests_quickfalse.mjs
```

- To run a single image quickly with detailed debug:

```bash
HOUGH_DEBUG=1 node tmp/run_single_debug.mjs
# or quick=false
HOUGH_DEBUG=1 node tmp/run_single_debug_quickfalse.mjs
```

- When running through the HTTP server route, you can enable server stack traces in JSON responses (development only) by setting `SHOW_STACK=1` in the environment before starting the server. The route is in `WebApplication/server/src/routes.js`.

Where debug artifacts go
- The Python helper writes `/tmp/hough_result_*.json` with its detection result (also prints the JSON to stdout).
- The JS analyzer writes `/tmp/analysis_debug_*.json` when `debug` is true; that file contains the full `result` object including debug fields such as `calibration`, `pixelScale`, `detectorUsed`, and `statistics`.

Important fields in the analyzer debug JSON
- `calibration`: { measuredOuterPx, outerDiameterPx, innerDiameterPx, outerDiameterMm, pixelScale }
- `pixelScale`: pixels per mm used for particle size conversion
- `detectorUsed`: one of 'hough' | 'radial' | 'avg' | 'box' | 'box' (what provided center/radii)
- `statistics`: { count, mean, stdDev, mode, D10, D50, D90 }
- `debug.totalThresholded`, `debug.thresholdedInsideInner`: counts of thresholded pixels overall and those inside the inner circle

Testing and CI notes
- The minimal server-side tests are in `WebApplication/server/test/analysis_test.mjs` and exercise the two sample images under `WebApplication/client/src/resources/`.
- To add CI, run `node` tests and ensure a Python venv with opencv is available in the runner, or mock `runHoughDetect` to avoid Python dependency in CI. For local dev we rely on the Python helper.

Where to tune Hough params
- `WebApplication/server/util/hough_detect.py` exposes CLI args `--dp`, `--param1`, `--param2`, `--downsample`, `--min-radius`, `--max-radius`. The Node wrapper in `runHoughDetect()` enumerates candidate sets; tune those there if you want a different default.

Developer workflow checklist
- Create Python venv and install opencv (see above).
- Run the analyzer unit tests: `HOUGH_DEBUG=1 node server/test/analysis_test.mjs` (use `REQUIRE_HOUGH=0` if python helper not available).
- Use the tmp debug runners for quick iteration.
- If you change `analysis.js`, run the built-in syntax checker (if present) and run the tests.

Common debug tips
- If Hough returns a very small or very large diameter, check `/tmp/hough_result_*.json` to see raw helper values and `analysis_debug_*.json` to see what `analyzeImage` did with that value.
- Use `HOUGH_DEBUG=1` to enable extra logging via logger.
- Use `SHOW_STACK=1` to get stack traces in HTTP responses (development only).

Contact / notes
- This document lives under `WebApplication/docs/DEVELOPER.md`. If you want it placed elsewhere or expanded with API docs for `analyzeImage`, tell me and I'll extend it.
