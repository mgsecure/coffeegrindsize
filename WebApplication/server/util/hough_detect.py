#!/usr/bin/env python3
import argparse
import json
import math
import cv2
import numpy as np
import os

parser = argparse.ArgumentParser(description='Hough circle detector helper')
parser.add_argument('--input', required=True, help='Input image path')
parser.add_argument('--downsample', type=int, default=1200, help='Max width to downsample for detection')
parser.add_argument('--min-radius', type=int, default=10, help='Min circle radius to detect')
parser.add_argument('--max-radius', type=int, default=2000, help='Max circle radius to detect')
parser.add_argument('--dp', type=float, default=1.0, help='Inverse ratio of accumulator resolution to image resolution')
parser.add_argument('--param1', type=float, default=50.0, help='First method-specific parameter for Hough (higher threshold for Canny)')
parser.add_argument('--param2', type=float, default=20.0, help='Second method-specific parameter for Hough (accumulator threshold)')
args = parser.parse_args()

img = cv2.imread(args.input, cv2.IMREAD_COLOR)
if img is None:
    print(json.dumps({'error':'Unable to read image'}))
    exit(1)

h, w = img.shape[:2]
if w > args.downsample:
    scale = args.downsample / float(w)
    img = cv2.resize(img, (args.downsample, int(h * scale)), interpolation=cv2.INTER_AREA)
else:
    scale = 1.0

# convert to grayscale once (on the possibly downsampled image)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
# Smooth a bit to reduce noise
gray = cv2.medianBlur(gray, 5)

# Run HoughCircles
minR = max(1, int(args.min_radius * scale))
maxR = max(minR + 1, int(args.max_radius * scale))
minDist = max(10, int(min(img.shape[:2]) / 8))

circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=args.dp, minDist=minDist,
                           param1=args.param1, param2=args.param2,
                           minRadius=minR, maxRadius=maxR)

if circles is None:
    print(json.dumps({'found': False}))
    exit(0)

circles = np.round(circles[0, :]).astype(int)
# choose the circle with largest radius as the likely outer annulus
best = max(circles, key=lambda c: c[2])
cy, cx, cr = best[1], best[0], best[2]
# convert back to original image coordinates
orig_cx = int(round(cx / scale))
orig_cy = int(round(cy / scale))
orig_cr = int(round(cr / scale))

# Attempt inner-circle detection using Hough on Canny edges first (downsampled)
inner_radius = None
try:
    min_inner_r = max(1, int(cr * 0.3))
    max_inner_r = max(min_inner_r + 1, int(cr * 0.95))
    if min_inner_r < max_inner_r and max_inner_r - min_inner_r > 5:
        # Build an edge map and try Hough on edges for the inner bright boundary
        edges = cv2.Canny(gray, 50, 150)
        # Slightly more permissive accumulator threshold for inner circle
        try:
            inner_circles = cv2.HoughCircles(edges, cv2.HOUGH_GRADIENT, dp=max(1.0, args.dp), minDist=max(8, int(cr/8)),
                                             param1=max(30, int(args.param1)), param2=max(10, int(args.param2/2)),
                                             minRadius=min_inner_r, maxRadius=max_inner_r)
        except Exception:
            inner_circles = None

        if inner_circles is not None and len(inner_circles[0]) > 0:
            inner_circles = np.round(inner_circles[0, :]).astype(int)
            best_inner = None
            best_dist = None
            for ic in inner_circles:
                icx, icy, ir = ic[0], ic[1], ic[2]
                dist = math.hypot(icx - cx, icy - cy)
                if ir < cr and (best_inner is None or dist < best_dist):
                    best_inner = ic
                    best_dist = dist
            if best_inner is not None:
                inner_radius = int(round(int(best_inner[2]) / scale))
except Exception:
    inner_radius = None

# estimate inner radius by sampling radial intensity inward from outer radius
if inner_radius is None:
    angles = np.linspace(0, 2*math.pi, 360, endpoint=False)
    inner_radii_down = []
    # work in downsampled coords (cx,cy,cr are in downsampled pixels)
    gray_med = float(np.median(gray))
    dark_threshold = gray_med * 0.9
    for theta in angles[::3]:
        vals = []
        max_r = int(cr)
        for r in range(0, max_r + 1):
            x = int(round(cx + r * math.cos(theta)))
            y = int(round(cy + r * math.sin(theta)))
            if x < 0 or x >= gray.shape[1] or y < 0 or y >= gray.shape[0]:
                break
            vals.append(int(gray[y, x]))
        if len(vals) < 8:
            continue
        mask = np.array(vals) < dark_threshold
        if not mask.any():
            continue
        # find contiguous True runs
        runs = []
        inrun = False
        start = 0
        for i, m in enumerate(mask):
            if m and not inrun:
                inrun = True; start = i
            elif not m and inrun:
                runs.append((start, i - 1)); inrun = False
        if inrun:
            runs.append((start, len(mask) - 1))
        if len(runs) == 0:
            continue
        # choose run with largest end (closest to outer edge)
        best = max(runs, key=lambda t: t[1])
        inner_r_down = best[0]
        # require the run to extend reasonably (avoid tiny noise runs)
        if best[1] - best[0] >= max(2, int(0.01 * cr)):
            inner_radii_down.append(inner_r_down)

    if len(inner_radii_down) >= 5:
        # median inner radius in downsampled coords -> convert to original pixels
        med_down = float(np.median(inner_radii_down))
        inner_radius = int(round(med_down / scale))

out = {
    'found': True,
    'cx': orig_cx,
    'cy': orig_cy,
    'outerRadius': orig_cr,
}
if inner_radius:
    out['innerRadius'] = inner_radius

json_out = json.dumps(out)
# Always write result to a temp JSON file for robust capture (helps debugging/runs where stdout is suppressed)
try:
    import tempfile
    tmpf = tempfile.NamedTemporaryFile(prefix='hough_result_', suffix='.json', dir='/tmp', delete=False)
    tmpf.write(json_out.encode('utf8'))
    tmpf.flush()
    tmpf.close()
    if 'HOUGH_DEBUG' in globals() or 'HOUGH_DEBUG' in os.environ:
        print('HOUGH_DEBUG wrote result to', tmpf.name)
except Exception:
    pass

print(json_out)
