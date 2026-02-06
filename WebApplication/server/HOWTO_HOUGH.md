Hough Circle Helper (Python) - Quickstart

This project can optionally use OpenCV's HoughCircles to detect the annulus in sample images.
Two runtime modes exist:

- Python helper (recommended for development): uses `opencv-python` and `numpy`.
- Node-native binding (optional): `opencv4nodejs` (native build required).

Python helper setup (recommended):

1. Create and activate a virtualenv and install requirements:

```bash
cd WebApplication/server
./setup_python_hough.sh
# then:
source venv_hough/bin/activate
```

2. Run tests (example):

```bash
node WebApplication/server/test/analysis_test.mjs
```

Notes:
- The analyzer will attempt to run the Python helper first; if the helper is not available it will fall back to a node-native binding if installed.
- `hough_detect.py` default parameters are tuned to be permissive for the provided sample images. You can adjust `options.houghParam1`, `options.houghParam2`, and `options.houghDp` when calling `analyzeImage`.

Node-native binding (advanced):
- If you prefer to avoid Python, install OpenCV (e.g. `brew install opencv`) and then add `opencv4nodejs` to the server package with:

```bash
OPENCV4NODEJS_AUTOBUILD=1 npm install --prefix WebApplication/server opencv4nodejs
```

This repository will attempt to use the Python helper first and then node-native binding as fallback.
