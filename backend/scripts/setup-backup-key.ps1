param([switch]$Import)

$ErrorActionPreference = 'Stop'
$storeDir = Join-Path $env:LOCALAPPDATA 'Mushabaka'
$keyPath = Join-Path $storeDir 'backup-key.dpapi'

if (Test-Path -LiteralPath $keyPath) {
  throw 'A backup key already exists. It will not be replaced because older backups depend on it.'
}

if ($Import) {
  $secureKey = Read-Host 'Paste the backup key from your password manager' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
} else {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  $key = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  [Array]::Clear($bytes, 0, $bytes.Length)
  $secureKey = ConvertTo-SecureString -String $key -AsPlainText -Force
}

if ($key -notmatch '^[0-9a-fA-F]{64}$') {
  throw 'Invalid key. Exactly 64 hexadecimal characters are required.'
}

$protected = ConvertFrom-SecureString -SecureString $secureKey
New-Item -ItemType Directory -Path $storeDir -Force | Out-Null
$stream = [IO.File]::Open($keyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $data = [Text.Encoding]::ASCII.GetBytes($protected)
  $stream.Write($data, 0, $data.Length)
} finally {
  $stream.Dispose()
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $keyPath
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  Set-Acl -LiteralPath $keyPath -AclObject $acl
} catch {
  Remove-Item -LiteralPath $keyPath -Force
  throw 'Could not restrict key file permissions. The local key was not saved.'
}

Write-Host 'The local key is protected for this Windows account outside the repository.'
if (-not $Import) {
  Write-Host 'Save this key NOW in your password manager and an encrypted USB copy. Never send it in chat or email:'
  Write-Host $key
  Read-Host 'Press Enter only after saving the key in both places' | Out-Null
  Clear-Host
}
$key = $null
$secureKey = $null
