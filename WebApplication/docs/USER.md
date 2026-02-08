User guide — coffeegrindsize WebApplication

Overview
This application analyzes photos of a calibration annulus (target outer diameter 93 mm). It detects the annulus, computes a pixel-to-mm scale, thresholds the image to find dark particles inside the annulus, and reports particle size statistics (D10/D50/D90, mean, mode, stdDev).

Quick start (end user)
1. Open the web client:
   - Serve `WebApplication/client` with your normal dev server (the repo includes a client + server). For quick local tests the test runner scripts call the analysis function directly.
2. Upload an image (the image should show the dark annulus and particles inside it). Two sample images are included in `WebApplication/client/src/resources/`.
3. Configure options on the UI (defaults match the target annulus):
   - Quick analysis (on/off): if off, analysis runs a more thorough clustering step (slower but may produce better separation of touching particles).
   - Brightness / Contrast: Adjust image brightness and contrast before analysis. This can help the annulus detector in poor lighting conditions.
   - Reference mode: Always detected (default) — analyzer will use the measured annulus diameter from the image. Alternate modes: `auto` or `fixed`.
4. Click Analyze. Results include:
   - `pixelScale` (pix/mm)
   - `particleCount`
   - `statistics` { D10, D50, D90, mean, mode, stdDev }
   - `thresholdImage` and `outlinesImage` — result images encoded as data URLs for visual inspection.

Interpretation of results
- `D10`, `D50`, `D90` are diameter percentiles by mass-equivalent diameter.
- `mode` is the modal diameter estimated from a histogram.
- `stdDev` is the sample standard deviation across particle diameters.

Common issues and troubleshooting
- If the analyzer reports a very small `pixelScale` or zero particles, check that:
  - The annulus is fully visible and not cut off at the image edges.
  - The image is not extremely low-resolution (the app accepts downsampling but needs sufficient pixels to detect the annulus).
- For cases where Hough detection fails, the analyzer uses radial-profile fallback. If you have repeated failures, try the lower-resolution test image to see if parameter tuning helps.

Files and artifacts
- Threshold and outlines images are returned in the response as data URLs (`thresholdImage` and `outlinesImage`). You can save them locally for inspection.
- The server writes debug JSON to `/tmp/analysis_debug_*.json` when debug mode is enabled. This file contains per-pixel counts and calibration used.

Options available (exposed via UI or server API)
- `quick` (boolean): true = faster, less clump splitting; false = slower but attempts to break up large clumps.
- `referenceMode`: 'detected' | 'auto' | 'fixed'
  - 'detected': use the measured annulus from the image when available (default for per-image calibration).
  - 'auto': prefer expected calibration unless the detected diameter is within tolerance.
  - 'fixed': always use the expected source calibration.

Server API (simple)
- Endpoint: POST /analyze (prefix may vary depending on server configuration)
- Form fields:
  - `image`: file upload (required)
  - `quick`: 'true' | 'false'
  - `brightness`: numeric (default 1.0)
  - `contrast`: numeric (default 1.0)
  - Optional numeric tuning fields: `threshold`, `maxClusterAxis`, `minSurface`, `maxSurface`, `minRoundness`
- Response: JSON object with `pixelScale`, `particleCount`, `statistics`, `thresholdImage`, `outlinesImage`, `calibration`, and `debug` (only when `debug` enabled).

Example `curl` request (local server):
```bash
curl -X POST 'http://localhost:3000/analyze' \
  -F "image=@/path/to/image.jpg" \
  -F "quick=false"
```

If you need help interpreting results or seeing unexpected changes in counts, provide the `/tmp/analysis_debug_*.json` file and a sample image and we can investigate further.

Where to get support
- For developer-level troubleshooting, see `WebApplication/docs/DEVELOPER.md`.
- To debug a failing analysis run, enable debug mode in the UI (if available) or call the API with `debug` enabled and send the `/tmp/analysis_debug_*.json` file along with the original image.
