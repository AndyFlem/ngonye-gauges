#!/usr/bin/env bash
# Daily gauge-data pipeline: process_raw.js -> build_annual_summaries.js.
# Intended to be run once per day (e.g. via cron at 1am). See crontab example below.
set -euo pipefail

# --- Configuration ---------------------------------------------------------
# Set these to the real paths before enabling the cron job.
export RAW_DIR="/home/wpc_ftp"
export OUT_DIR="/mnt/data/gauge-data"

# --- Paths -------------------------------------------------------------
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/daily_update.log"
NODE_BIN="/home/ubuntu/.nvm/versions/node/v22.15.1/bin/node"

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

log "=== daily_update start (RAW_DIR=$RAW_DIR OUT_DIR=$OUT_DIR) ==="

if "$NODE_BIN" "$REPO_DIR/lib/process_raw.js" >> "$LOG_FILE" 2>&1; then
  log "process_raw.js OK"
else
  log "process_raw.js FAILED (exit $?) - aborting before build_annual_summaries.js"
  exit 1
fi

if "$NODE_BIN" "$REPO_DIR/lib/build_annual_summaries.js" >> "$LOG_FILE" 2>&1; then
  log "build_annual_summaries.js OK"
else
  log "build_annual_summaries.js FAILED (exit $?)"
  exit 1
fi

log "=== daily_update done ==="
