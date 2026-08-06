[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [switch]$AllowPendingPromotion,
  [switch]$SupervisorOwnedLock,
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
$AdminMcpRoot = Join-Path $InstallRoot 'admin-mcp'
$EntryPoint = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-shadow-main.js'
$StateRoot = Join-Path $InstallRoot 'state'
$StatePath = Join-Path $StateRoot 'credential-rotation.json'
$LockPath = Join-Path $StateRoot 'credential-rotation.lock'
$CredentialRoot = Join-Path $InstallRoot 'credentials'
$SupervisorMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-credential-supervisor-main.js'
$StdoutPath = Join-Path $StateRoot 'shadow-runner.stdout.log'
$StderrPath = Join-Path $StateRoot 'shadow-runner.stderr.log'

function Get-SupportAutopilotRunnerProcess {
  $pattern = '^\s*"?' + [regex]::Escape($NodeExecutable) + '"?\s+"?' +
    [regex]::Escape($EntryPoint) + '"?\s*$'
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.ExecutablePath -ieq $NodeExecutable -and
      $_.CommandLine -match $pattern
    })
}

$existing = @(Get-SupportAutopilotRunnerProcess)
if ($PlanOnly) {
  [pscustomobject]@{
    action = 'start'
    alreadyRunning = $existing.Count -gt 0
    executable = $NodeExecutable
    entryPoint = $EntryPoint
    installRoot = $InstallRoot
    planOnly = $true
    stateExists = Test-Path -LiteralPath $StatePath -PathType Leaf
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $StateRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}
$lockStream = $null
if (-not $SupervisorOwnedLock) {
  try {
    $lockStream = [IO.File]::Open(
      $LockPath,
      [IO.FileMode]::OpenOrCreate,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
  }
  catch {
    [pscustomobject]@{ reason = 'rotation_lock_held'; started = $false } |
      ConvertTo-Json -Compress
    exit 0
  }
}

try {
$existing = @(Get-SupportAutopilotRunnerProcess)
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  [pscustomobject]@{ reason = 'credential_state_missing'; started = $false } |
    ConvertTo-Json -Compress
  exit 0
}
foreach ($requiredPath in @($NodeExecutable, $EntryPoint, $SupervisorMain)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "required runner file is missing"
  }
}
$validation = & $NodeExecutable $SupervisorMain `
  validate-state `
  --state $StatePath `
  --credential-root $CredentialRoot 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'credential rotation state is invalid'
}
$rotationState = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 |
  ConvertFrom-Json
if ($null -ne $rotationState.pendingRotation) {
  $promotionAllowed = $AllowPendingPromotion -and
    $rotationState.pendingRotation.stage -eq 'candidate_promoted'
  if (-not $promotionAllowed) {
    [pscustomobject]@{ reason = 'rotation_pending'; started = $false } |
      ConvertTo-Json -Compress
    exit 0
  }
}

if ($existing.Count -gt 0) {
  [pscustomobject]@{
    processIds = @($existing.ProcessId)
    reason = 'already_running'
    started = $false
  } | ConvertTo-Json -Compress
  exit 0
}

$AttestationPath = Join-Path $StateRoot 'privacy-attestation.json'
$attestation = Get-Content -LiteralPath $AttestationPath -Raw -Encoding UTF8 |
  ConvertFrom-Json
if (
  [string]::IsNullOrWhiteSpace([string]$attestation.attestationId) -or
  [string]::IsNullOrWhiteSpace([string]$attestation.expiresAt)
) {
  throw 'privacy attestation metadata is invalid'
}

Remove-Item Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ADMIN_API_TOKEN -ErrorAction SilentlyContinue

$env:SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED = 'true'
$env:SUPPORT_AUTOPILOT_CODEX_EXECUTABLE = Join-Path $InstallRoot 'standalone-codex\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$env:SUPPORT_AUTOPILOT_NODE_EXECUTABLE = $NodeExecutable
$env:SUPPORT_AUTOPILOT_CODEX_HOME = Join-Path $InstallRoot 'codex-home'
$env:SUPPORT_AUTOPILOT_RUNTIME_DIR = Join-Path $InstallRoot 'runtime-empty'
$env:SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH = Join-Path $InstallRoot 'credentials\support-autopilot.dpapi'
$env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH = $AttestationPath
$env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID = [string]$attestation.attestationId
$env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT = [string]$attestation.expiresAt
$env:SUPPORT_AUTOPILOT_WORKER_ID = 'arkadiy.pro.shadow.1'
$env:SUPPORT_AUTOPILOT_DAILY_BUDGET = '100'
$env:SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS = '600000'
$env:SUPPORT_AUTOPILOT_BUDGET_STATE_PATH = Join-Path $StateRoot 'daily-budget.json'
$env:SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-mcp-launcher.js'
$env:ADMIN_API_BASE_URL = 'https://malikbot.ru/new-admin'

[IO.File]::WriteAllText($StdoutPath, '', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($StderrPath, '', [Text.UTF8Encoding]::new($false))

$process = Start-Process `
  -FilePath $NodeExecutable `
  -ArgumentList @("`"$EntryPoint`"") `
  -WorkingDirectory $AdminMcpRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StdoutPath `
  -RedirectStandardError $StderrPath `
  -PassThru

[pscustomobject]@{
  processId = $process.Id
  started = $true
} | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $lockStream) {
    $lockStream.Dispose()
  }
}
