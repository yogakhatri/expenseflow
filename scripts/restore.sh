#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "Usage: $0 BACKUP_FILE.db"; exit 2; fi
curl -fsS -X POST http://127.0.0.1:8787/api/restore \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8787' \
  --data "{\"name\":\"$1\"}"
echo
