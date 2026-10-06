$ErrorActionPreference = 'Stop'
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/backup' -Headers @{ Origin = 'http://127.0.0.1:8787' }
