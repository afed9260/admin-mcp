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
$SecurityScript = Join-Path $PSScriptRoot 'support-autopilot-windows-security.ps1'
. $SecurityScript
$EntryPoint = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-shadow-main.js'
$StateRoot = Join-Path $InstallRoot 'state'
$StatePath = Join-Path $StateRoot 'credential-rotation.json'
$LockPath = Join-Path $StateRoot 'credential-rotation.lock'
$CredentialRoot = Join-Path $InstallRoot 'credentials'
$SupervisorMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-credential-supervisor-main.js'
$HealthMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-local-health-main.js'
$StopScript = Join-Path $AdminMcpRoot 'scripts\stop-support-autopilot-shadow-runner.ps1'
$DrainRequestPath = Join-Path $StateRoot 'shadow-runner.drain'
$StdoutPath = Join-Path $StateRoot 'shadow-runner.stdout.log'
$StderrPath = Join-Path $StateRoot 'shadow-runner.stderr.log'
$EventPath = Join-Path $StateRoot $script:SupportAutopilotEventFileName

trap {
  try {
    if (Test-Path -LiteralPath $StateRoot -PathType Container) {
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'runner_start_failed' `
        -Outcome 'fixed_failure'
    }
  }
  catch {}
  [Console]::Error.WriteLine('SUPPORT_AUTOPILOT_RUNNER_START_FAILED')
  exit 1
}

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
Set-SupportAutopilotCurrentUserAcl -Path $StateRoot -Container
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
try {
  Assert-NoSupportAutopilotPlaintextTokenEnvironment
}
catch {
  Write-SupportAutopilotRedactedEvent `
    -EventPath $EventPath `
    -EventCode 'runner_start_blocked' `
    -Outcome 'plaintext_environment'
  throw 'plaintext_token_environment_present'
}
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  [pscustomobject]@{ reason = 'credential_state_missing'; started = $false } |
    ConvertTo-Json -Compress
  exit 0
}
Set-SupportAutopilotCurrentUserAcl -Path $StatePath
foreach ($requiredPath in @(
  $NodeExecutable,
  $EntryPoint,
  $SupervisorMain,
  $HealthMain,
  $StopScript
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "required runner file is missing"
  }
}
$decisionOutput = & $NodeExecutable $SupervisorMain `
  decision `
  --state $StatePath `
  --credential-root $CredentialRoot 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'credential rotation state is invalid'
}
$credentialDecision = ($decisionOutput | Out-String).Trim() | ConvertFrom-Json
$rotationState = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 |
  ConvertFrom-Json
if ($null -eq $rotationState.activeCredential) {
  [pscustomobject]@{ reason = 'credential_state_seed_required'; started = $false } |
    ConvertTo-Json -Compress
  exit 0
}
$promotionAllowed = $null -ne $rotationState.pendingRotation -and
  $AllowPendingPromotion -and
  $rotationState.pendingRotation.stage -eq 'candidate_promoted'
$effectiveCredentialExpired = $credentialDecision.expired -eq $true
if ($promotionAllowed) {
  $effectiveCredentialExpired = [DateTimeOffset]::UtcNow -ge
    ([DateTimeOffset]$rotationState.pendingRotation.expiresAt)
}
if ($effectiveCredentialExpired) {
  [pscustomobject]@{ reason = 'credential_expired'; started = $false } |
    ConvertTo-Json -Compress
  exit 0
}
if ($null -ne $rotationState.pendingRotation) {
  if (-not $promotionAllowed) {
    [pscustomobject]@{ reason = 'rotation_pending'; started = $false } |
      ConvertTo-Json -Compress
    exit 0
  }
}

$AttestationPath = Join-Path $StateRoot 'privacy-attestation.json'
Set-SupportAutopilotCurrentUserAcl -Path $AttestationPath
$attestation = Get-Content -LiteralPath $AttestationPath -Raw -Encoding UTF8 |
  ConvertFrom-Json
if (
  [string]::IsNullOrWhiteSpace([string]$attestation.attestationId) -or
  [string]::IsNullOrWhiteSpace([string]$attestation.expiresAt)
) {
  throw 'privacy attestation metadata is invalid'
}

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
$env:SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH = $DrainRequestPath
$env:SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-mcp-launcher.js'
$env:ADMIN_API_BASE_URL = 'https://malikbot.ru/new-admin'

if ($existing.Count -gt 1) {
  throw 'multiple_exact_runner_processes'
}
if ($existing.Count -eq 1) {
  $healthOutput = & $NodeExecutable $HealthMain 2>$null
  if ($LASTEXITCODE -ne 0) {
    [pscustomobject]@{ reason = 'runner_health_unavailable'; started = $false } |
      ConvertTo-Json -Compress
    exit 0
  }
  $health = ($healthOutput | Out-String).Trim() | ConvertFrom-Json
  if ($health.runnerFresh -eq $true) {
    [pscustomobject]@{
      processIds = @($existing.ProcessId)
      reason = 'already_running'
      started = $false
    } | ConvertTo-Json -Compress
    exit 0
  }
  if ([long]$health.activeLeases -ne 0) {
    [pscustomobject]@{ reason = 'stale_runner_has_active_work'; started = $false } |
      ConvertTo-Json -Compress
    exit 0
  }
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $StopScript `
    -InstallRoot $InstallRoot `
    -NodeExecutable $NodeExecutable `
    -StopTimeoutSeconds 120 `
    -ForceAfterTimeout | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'stale_runner_stop_failed'
  }
}

if (Test-Path -LiteralPath $DrainRequestPath -PathType Leaf) {
  Remove-Item -LiteralPath $DrainRequestPath -Force
}

[IO.File]::WriteAllText($StdoutPath, '', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($StderrPath, '', [Text.UTF8Encoding]::new($false))
Set-SupportAutopilotCurrentUserAcl -Path $StdoutPath
Set-SupportAutopilotCurrentUserAcl -Path $StderrPath

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
Write-SupportAutopilotRedactedEvent `
  -EventPath $EventPath `
  -EventCode 'runner_started' `
  -Outcome 'started'
}
finally {
  if ($null -ne $lockStream) {
    $lockStream.Dispose()
  }
}
