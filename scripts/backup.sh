#!/bin/sh
set -eu
curl -fsS -X POST http://127.0.0.1:8787/api/backup -H 'Origin: http://127.0.0.1:8787'
echo
