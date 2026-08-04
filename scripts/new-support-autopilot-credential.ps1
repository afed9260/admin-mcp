param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [ValidateRange(1, 23)]
  [int]$LifetimeHours = 23
)

$ErrorActionPreference = 'Stop'

if (-not [IO.Path]::IsPathRooted($OutputPath) -or $OutputPath.Contains([char]0)) {
  throw 'OutputPath must be an absolute path.'
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$repositoryPrefix = $repositoryRoot.TrimEnd('\') + '\'
if ($resolvedOutput.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Credential output must be outside the repository.'
}
if (Test-Path -LiteralPath $resolvedOutput) {
  throw 'Credential output already exists.'
}

$resolvedParent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $resolvedParent -Force | Out-Null
$temporaryPath = Join-Path $resolvedParent ('.support-autopilot-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$tokenBytes = New-Object byte[] 32
$tokenUtf8 = $null
$token = $null
$secureToken = $null
$encrypted = $null
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$sha = [Security.Cryptography.SHA256]::Create()

try {
  $rng.GetBytes($tokenBytes)
  $token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $tokenUtf8 = [Text.Encoding]::UTF8.GetBytes($token)
  $tokenHash = -join ($sha.ComputeHash($tokenUtf8) | ForEach-Object { $_.ToString('x2') })

  $secureToken = ConvertTo-SecureString -String $token -AsPlainText -Force
  $encrypted = ConvertFrom-SecureString -SecureString $secureToken
  [IO.File]::WriteAllText($temporaryPath, $encrypted, [Text.UTF8Encoding]::new($false))

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner([Security.Principal.NTAccount]::new($identity))
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $identity,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $temporaryPath -AclObject $acl

  Move-Item -LiteralPath $temporaryPath -Destination $resolvedOutput
  $temporaryPath = $null

  $issuedAt = [DateTimeOffset]::UtcNow.AddMinutes(-1)
  $expiresAt = $issuedAt.AddHours($LifetimeHours)
  [ordered]@{
    tokenSha256 = $tokenHash
    issuedAt = $issuedAt.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
    expiresAt = $expiresAt.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  } | ConvertTo-Json -Compress
}
finally {
  if ($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
  if ($tokenBytes) {
    [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
  }
  if ($tokenUtf8) {
    [Array]::Clear($tokenUtf8, 0, $tokenUtf8.Length)
  }
  $encrypted = $null
  $secureToken = $null
  $token = $null
  $sha.Dispose()
  $rng.Dispose()
}
