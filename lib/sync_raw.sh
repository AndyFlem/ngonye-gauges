#!/usr/bin/env bash
# Two-way sync between the local Raw folder and the remote FTP dropbox:
#   - files new/changed on the remote are pulled down to local
#   - files present locally but missing on the remote are pushed up
# Additive only in both directions - nothing is ever deleted on either side.
#
# Usage:
#   scripts/sync_raw.sh            # sync
#   scripts/sync_raw.sh --dry-run  # preview what would be transferred

set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/andy/ec2_ire.pem}"
REMOTE_HOST="${REMOTE_HOST:-ubuntu@gis.westernpower.org}"
REMOTE_PATH="${REMOTE_PATH:-/home/wpc_ftp/}"
LOCAL_PATH="${LOCAL_PATH:-/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/Ngonye_Automatic_Gauges/Raw/}"

mkdir -p "$LOCAL_PATH"

RSYNC_ARGS=(
  -rlptvz
  --no-owner --no-group
  --exclude=processed/
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
)

if [[ "${1:-}" == "--dry-run" ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

echo "--- Pulling remote -> local ---"
rsync "${RSYNC_ARGS[@]}" "$REMOTE_HOST:$REMOTE_PATH" "$LOCAL_PATH"

echo "--- Pushing local -> remote ---"
rsync "${RSYNC_ARGS[@]}" "$LOCAL_PATH" "$REMOTE_HOST:$REMOTE_PATH"
