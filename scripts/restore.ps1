param([Parameter(Mandatory=$true)][string]$Name)
$ErrorActionPreference = 'Stop'
$body = @{ name = $Name } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/restore' -ContentType 'application/json' -Headers @{ Origin = 'http://127.0.0.1:8787' } -Body $body
