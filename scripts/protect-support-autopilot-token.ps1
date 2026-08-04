param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $OutputPath))
New-Item -ItemType Directory -Path $resolvedParent -Force | Out-Null
$resolvedOutput = Join-Path $resolvedParent (Split-Path -Leaf $OutputPath)

$secureToken = Read-Host 'Support autopilot service token' -AsSecureString
$encrypted = ConvertFrom-SecureString -SecureString $secureToken
[IO.File]::WriteAllText($resolvedOutput, $encrypted, [Text.UTF8Encoding]::new($false))

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
Set-Acl -LiteralPath $resolvedOutput -AclObject $acl

Write-Output "Protected credential written for the current Windows user."
