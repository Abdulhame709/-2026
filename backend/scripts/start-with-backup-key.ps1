param(
  [ValidateSet('dev', 'start', 'verify', 'rehearse')][string]$Mode = 'dev',
  [string]$BackupName
)

$ErrorActionPreference = 'Stop'
$keyPath = Join-Path (Join-Path $env:LOCALAPPDATA 'Mushabaka') 'backup-key.dpapi'
if (-not (Test-Path -LiteralPath $keyPath)) {
  throw 'Backup key is not configured. Run scripts/setup-backup-key.ps1 first.'
}

$secureKey = ConvertTo-SecureString -String (Get-Content -LiteralPath $keyPath -Raw)
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
if ($key -notmatch '^[0-9a-fA-F]{64}$') {
  throw 'The local backup key is invalid.'
}

$env:BACKUP_ENCRYPTION_KEY = $key
$key = $null
$exitCode = 1
try {
  if ($Mode -eq 'verify' -or $Mode -eq 'rehearse') {
    if (-not $BackupName) { throw 'Provide -BackupName with the exact .enc filename.' }
    if ($Mode -eq 'verify') {
      & node.exe scripts/verify-backup.mjs $BackupName
    } else {
      & node.exe scripts/rehearse-backup-restore.mjs $BackupName
    }
  } else {
    & npm.cmd run $Mode
  }
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:BACKUP_ENCRYPTION_KEY -ErrorAction SilentlyContinue
}
exit $exitCode
