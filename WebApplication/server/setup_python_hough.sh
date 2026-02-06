#!/usr/bin/env bash
set -euo pipefail

PYTHON=${PYTHON:-python3}
VENV_DIR="venv_hough"
REQ_FILE="$(pwd)/util/requirements.txt"

echo "Creating virtualenv in $VENV_DIR using $PYTHON..."
$PYTHON -m venv "$VENV_DIR"

echo "Activating virtualenv and upgrading pip..."
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip

if [ -f "$REQ_FILE" ]; then
  echo "Installing python requirements from $REQ_FILE..."
  pip install -r "$REQ_FILE"
else
  echo "Requirements file not found: $REQ_FILE"
  exit 1
fi

echo "Python helper environment ready. To activate it later run:"
echo "  source $VENV_DIR/bin/activate"

echo "Run tests with (after activating venv if needed):"
echo "  node WebApplication/server/test/analysis_test.mjs"
