[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedRuntimeRevision
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-ExactProperties {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string[]]$Names
  )
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Names | Sort-Object)
  if ($actual.Count -ne $expected.Count) {
    throw 'status schema mismatch'
  }
  for ($index = 0; $index -lt $actual.Count; $index += 1) {
    if ($actual[$index] -cne $expected[$index]) {
      throw 'status schema mismatch'
    }
  }
}

function Assert-Counter {
  param([Parameter(Mandatory = $true)]$Value)
  if (
    $Value -isnot [byte] -and
    $Value -isnot [int16] -and
    $Value -isnot [int32] -and
    $Value -isnot [int64]
  ) {
    throw 'status counter invalid'
  }
  $counter = [long]$Value
  if ($counter -lt 0) {
    throw 'status counter invalid'
  }
  return $counter
}

function Get-ExactTaskStatus {
  param([Parameter(Mandatory = $true)][string]$Name)
  $matches = @(Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)
  if ($matches.Count -ne 1) {
    return 'blocked'
  }
  $state = [string]$matches[0].State
  return $(if ($state -in @('Ready', 'Running')) { 'ready' } else { 'blocked' })
}

try {
  if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
    $NodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  }
  $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
  $NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
  $AdminMcpRoot = Join-Path $InstallRoot 'admin-mcp'
  $StateRoot = Join-Path $InstallRoot 'state'
  $ManifestMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-runtime-manifest-main.js'
  $ManifestPath = Join-Path $StateRoot 'runtime-manifest.json'
  $HealthMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-local-health-main.js'
  $RunnerEntryPoint = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-shadow-main.js'
  $AttestationPath = Join-Path $StateRoot 'privacy-attestation.json'

  foreach ($requiredPath in @(
    $NodeExecutable,
    $ManifestMain,
    $ManifestPath,
    $HealthMain,
    $RunnerEntryPoint,
    $AttestationPath
  )) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw 'status input missing'
    }
  }

  & $NodeExecutable $ManifestMain verify `
    --root $AdminMcpRoot `
    --revision $ExpectedRuntimeRevision `
    --manifest $ManifestPath 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'runtime manifest verification failed'
  }

  $watchdogStatus = Get-ExactTaskStatus 'Sdelka Support Autopilot Watchdog'
  $supervisorStatus = Get-ExactTaskStatus 'Sdelka Support Autopilot Credential Supervisor'

  $pattern = '^\s*"?' + [regex]::Escape($NodeExecutable) + '"?\s+"?' +
    [regex]::Escape($RunnerEntryPoint) + '"?\s*$'
  $runnerCount = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.ExecutablePath -ieq $NodeExecutable -and
      $_.CommandLine -match $pattern
    }).Count

  $attestation = Get-Content -LiteralPath $AttestationPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  if (
    [string]::IsNullOrWhiteSpace([string]$attestation.attestationId) -or
    [string]::IsNullOrWhiteSpace([string]$attestation.expiresAt)
  ) {
    throw 'attestation metadata invalid'
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
  $env:SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-mcp-launcher.js'
  $env:ADMIN_API_BASE_URL = 'https://malikbot.ru/new-admin'

  $healthOutput = & $NodeExecutable $HealthMain 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'backend health failed'
  }
  $health = ($healthOutput | Out-String).Trim() | ConvertFrom-Json
  if (
    $health.reachable -ne $true -or
    $health.gatesReady -ne $true -or
    $health.runnerFresh -ne $true
  ) {
    throw 'backend health blocked'
  }

  Assert-ExactProperties $health.automation @('jobs', 'oldestPendingAgeMs', 'routes', 'sends')
  Assert-ExactProperties $health.automation.jobs @(
    'cancelled', 'completed', 'deadLetter', 'escalated',
    'executing', 'leased', 'pending', 'retryWait'
  )
  Assert-ExactProperties $health.automation.routes @('automatic', 'escalation', 'owner')
  Assert-ExactProperties $health.automation.sends @('deliveryUnknown', 'failed', 'sent')

  $jobs = [ordered]@{}
  foreach ($name in @('cancelled', 'completed', 'deadLetter', 'escalated', 'executing', 'leased', 'pending', 'retryWait')) {
    $jobs[$name] = Assert-Counter $health.automation.jobs.$name
  }
  $routes = [ordered]@{}
  foreach ($name in @('automatic', 'escalation', 'owner')) {
    $routes[$name] = Assert-Counter $health.automation.routes.$name
  }
  $sends = [ordered]@{}
  foreach ($name in @('deliveryUnknown', 'failed', 'sent')) {
    $sends[$name] = Assert-Counter $health.automation.sends.$name
  }
  $oldestPendingAgeMs = $null
  if ($null -ne $health.automation.oldestPendingAgeMs) {
    $oldestPendingAgeMs = Assert-Counter $health.automation.oldestPendingAgeMs
  }

  $ready = $runnerCount -eq 1 -and
    $watchdogStatus -eq 'ready' -and
    $supervisorStatus -eq 'ready'
  [pscustomobject][ordered]@{
    automation = [pscustomobject][ordered]@{
      jobs = [pscustomobject]$jobs
      oldestPendingAgeMs = $oldestPendingAgeMs
      routes = [pscustomobject]$routes
      sends = [pscustomobject]$sends
    }
    backend = 'ready'
    manifest = 'verified'
    outcome = $(if ($ready) { 'ready' } else { 'blocked' })
    runnerCount = $runnerCount
    runnerRevision = $ExpectedRuntimeRevision
    tasks = [pscustomobject][ordered]@{
      credentialSupervisor = $supervisorStatus
      watchdog = $watchdogStatus
    }
  } | ConvertTo-Json -Depth 8 -Compress
}
catch {
  [Console]::Error.WriteLine('SUPPORT_AUTOPILOT_STATUS_FAILED')
  exit 1
}
