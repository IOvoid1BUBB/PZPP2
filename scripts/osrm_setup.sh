#!/usr/bin/env bash
# Idempotent OSRM preprocessing for Poland (Geofabrik). Safe to re-run: completed steps are skipped.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${REPO_ROOT}/osrm-data"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"

mkdir -p "${DATA_DIR}"

PBF="${DATA_DIR}/map.osm.pbf"
if [[ ! -s "${PBF}" ]]; then
  echo "Downloading Poland extract to ${PBF} ..."
  wget -q --show-progress "https://download.geofabrik.de/europe/poland-latest.osm.pbf" -O "${PBF}.tmp"
  mv -f "${PBF}.tmp" "${PBF}"
else
  echo "PBF already present: ${PBF}"
fi

if [[ ! -f "${DATA_DIR}/map.osrm" ]]; then
  echo "Running osrm-extract ..."
  docker run --rm -v "${DATA_DIR}:/data" "${IMAGE}" osrm-extract -p /opt/car.lua /data/map.osm.pbf
else
  echo "Skipping osrm-extract (map.osrm exists)."
fi

if [[ ! -f "${DATA_DIR}/map.osrm.cells" ]]; then
  echo "Running osrm-partition ..."
  docker run --rm -v "${DATA_DIR}:/data" "${IMAGE}" osrm-partition /data/map.osrm
else
  echo "Skipping osrm-partition (map.osrm.cells exists)."
fi

if [[ ! -f "${DATA_DIR}/map.osrm.mldgr" ]]; then
  echo "Running osrm-customize ..."
  docker run --rm -v "${DATA_DIR}:/data" "${IMAGE}" osrm-customize /data/map.osrm
else
  echo "Skipping osrm-customize (map.osrm.mldgr exists)."
fi

echo "OSRM data ready under ${DATA_DIR}. Start routing with: docker compose up -d osrm"
