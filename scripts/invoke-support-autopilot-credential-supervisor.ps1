[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [string]$GitHubCliPath = 'gh.exe',
  [switch]$ForceRotation,
  [string]$ConfirmForceRotation = '',
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repository = 'afed9260/ai-agent-backend'
$Workflow = 'support-autopilot-credential-rotation.yml'
$WorkflowRef = 'support-autopilot-credential-rotation-v1'
$PinnedWorkflowSha = 'ba167befdbded7e6235d192b5d3c81e336f09490'
$ProductionRunnerName = 'prod-server-runner'
$ExpiredLeaseGraceMinutes = 30
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
$AdminMcpRoot = Join-Path $InstallRoot 'admin-mcp'
$SecurityScript = Join-Path $PSScriptRoot 'support-autopilot-windows-security.ps1'
. $SecurityScript
$ProcessHelperScript = Join-Path $PSScriptRoot 'support-autopilot-windows-process-helper.ps1'
. $ProcessHelperScript
$CredentialRoot = Join-Path $InstallRoot 'credentials'
$ActiveCredentialPath = Join-Path $CredentialRoot 'support-autopilot.dpapi'
$RollbackCredentialPath = Join-Path $CredentialRoot 'support-autopilot.rollback.dpapi'
$StateRoot = Join-Path $InstallRoot 'state'
$StatePath = Join-Path $StateRoot 'credential-rotation.json'
$LockPath = Join-Path $StateRoot 'credential-rotation.lock'
$SupervisorMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-credential-supervisor-main.js'
$HealthMain = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-local-health-main.js'
$RunnerEntryPoint = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-shadow-main.js'
$StartScript = Join-Path $AdminMcpRoot 'scripts\start-support-autopilot-shadow-runner.ps1'
$StopScript = Join-Path $AdminMcpRoot 'scripts\stop-support-autopilot-shadow-runner.ps1'
$CredentialGenerator = Join-Path $AdminMcpRoot 'scripts\new-support-autopilot-credential.ps1'
$InventoryPath = Join-Path $StateRoot 'credential-workflow-runs.json'
$EventPath = Join-Path $StateRoot $script:SupportAutopilotEventFileName
$RunnerStartStdoutPath = Join-Path $StateRoot 'runner-start.stdout.log'
$RunnerStartStderrPath = Join-Path $StateRoot 'runner-start.stderr.log'

trap {
  try {
    if (Test-Path -LiteralPath $StateRoot -PathType Container) {
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_supervisor_failed' `
        -Outcome 'fixed_failure'
    }
  }
  catch {}
  [Console]::Error.WriteLine('SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED')
  exit 1
}

function ConvertTo-CanonicalUtc {
  param([DateTimeOffset]$Value = [DateTimeOffset]::UtcNow)
  return $Value.UtcDateTime.ToString(
    'yyyy-MM-ddTHH:mm:ss.fffZ',
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Invoke-SupervisorCommand {
  param([Parameter(Mandatory = $true)][string[]]$CommandArguments)
  $output = & $NodeExecutable $SupervisorMain @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'credential_supervisor_boundary_failed'
  }
  return ($output | Out-String).Trim() | ConvertFrom-Json
}

function Write-RotationState {
  param([Parameter(Mandatory = $true)]$State)
  $temporaryPath = Join-Path $StateRoot ('.credential-rotation-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $backupPath = Join-Path $StateRoot '.credential-rotation.previous.json'
  try {
    $json = $State | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
    Set-SupportAutopilotCurrentUserAcl -Path $temporaryPath
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'credential_state_write' `
      -Outcome 'temporary_protected'
    Invoke-SupervisorCommand @(
      'validate-state',
      '--state', $temporaryPath,
      '--credential-root', $CredentialRoot
    ) | Out-Null
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'credential_state_write' `
      -Outcome 'schema_validated'
    try {
      if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
          Remove-Item -LiteralPath $backupPath -Force
        }
        [IO.File]::Replace($temporaryPath, $StatePath, $backupPath)
      }
      else {
        Move-Item -LiteralPath $temporaryPath -Destination $StatePath
      }
    }
    catch [UnauthorizedAccessException] {
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_state_write_failed' `
        -Outcome 'replace_unauthorized'
      throw
    }
    catch [IO.IOException] {
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_state_write_failed' `
        -Outcome 'replace_io'
      throw
    }
    catch [ArgumentException] {
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_state_write_failed' `
        -Outcome 'replace_argument'
      throw
    }
    Set-SupportAutopilotCurrentUserAcl -Path $StatePath
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'credential_state_write' `
      -Outcome 'atomically_replaced'
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
      try {
        Remove-Item -LiteralPath $backupPath -Force
      }
      catch {}
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Get-RotationState {
  Invoke-SupervisorCommand @(
    'validate-state',
    '--state', $StatePath,
    '--credential-root', $CredentialRoot
  ) | Out-Null
  return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function New-StateForStage {
  param(
    [Parameter(Mandatory = $true)]$CurrentState,
    $PendingRotation
  )
  return [ordered]@{
    schemaVersion = 1
    activeCredential = $CurrentState.activeCredential
    pendingRotation = $PendingRotation
    updatedAt = ConvertTo-CanonicalUtc
  }
}

function Set-RunnerEnvironment {
  $attestationPath = Join-Path $StateRoot 'privacy-attestation.json'
  $attestation = Get-Content -LiteralPath $attestationPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  $env:SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED = 'true'
  $env:SUPPORT_AUTOPILOT_CODEX_EXECUTABLE = Join-Path $InstallRoot 'standalone-codex\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
  $env:SUPPORT_AUTOPILOT_NODE_EXECUTABLE = $NodeExecutable
  $env:SUPPORT_AUTOPILOT_CODEX_HOME = Join-Path $InstallRoot 'codex-home'
  $env:SUPPORT_AUTOPILOT_RUNTIME_DIR = Join-Path $InstallRoot 'runtime-empty'
  $env:SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH = $ActiveCredentialPath
  $env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH = $attestationPath
  $env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID = [string]$attestation.attestationId
  $env:SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT = [string]$attestation.expiresAt
  $env:SUPPORT_AUTOPILOT_WORKER_ID = 'arkadiy.pro.shadow.1'
  $env:SUPPORT_AUTOPILOT_DAILY_BUDGET = '100'
  $env:SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS = '600000'
  $env:SUPPORT_AUTOPILOT_BUDGET_STATE_PATH = Join-Path $StateRoot 'daily-budget.json'
  $env:SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH = Join-Path $StateRoot 'shadow-runner.drain'
  $env:SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH = Join-Path $AdminMcpRoot 'dist\runner\support-autopilot-mcp-launcher.js'
  $env:ADMIN_API_BASE_URL = 'https://malikbot.ru/new-admin'
}

function Get-QueueHealth {
  Set-RunnerEnvironment
  $output = & $NodeExecutable $HealthMain 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'support_autopilot_health_failed'
  }
  return ($output | Out-String).Trim() | ConvertFrom-Json
}

function Assert-QueueGatesReady {
  param([Parameter(Mandatory = $true)]$Health)
  if ($Health.gatesReady -ne $true) {
    throw 'support_autopilot_gates_not_ready'
  }
}

function Get-ExactRunnerProcess {
  $pattern = '^\s*"?' + [regex]::Escape($NodeExecutable) + '"?\s+"?' +
    [regex]::Escape($RunnerEntryPoint) + '"?\s*$'
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.ExecutablePath -ieq $NodeExecutable -and
      $_.CommandLine -match $pattern
  })
}

function Start-Runner {
  param([switch]$PromotionMode)
  $heartbeatBaseline = (Get-QueueHealth).runnerLastSeenAt
  $existing = @(Get-ExactRunnerProcess)
  if ($existing.Count -gt 1) {
    throw 'multiple_exact_runner_processes'
  }
  if ($existing.Count -eq 1) {
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'runner_start_confirmed' `
      -Outcome 'already_running'
    return [pscustomobject]@{
      heartbeatBaseline = $heartbeatBaseline
      processId = 0
      started = $false
    }
  }

  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $StartScript + '"'),
    '-InstallRoot', ('"' + $InstallRoot + '"'),
    '-NodeExecutable', ('"' + $NodeExecutable + '"'),
    '-SupervisorOwnedLock'
  )
  if ($PromotionMode) {
    $arguments += '-AllowPendingPromotion'
  }
  [IO.File]::WriteAllText($RunnerStartStdoutPath, '', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($RunnerStartStderrPath, '', [Text.UTF8Encoding]::new($false))
  Set-SupportAutopilotCurrentUserAcl -Path $RunnerStartStdoutPath
  Set-SupportAutopilotCurrentUserAcl -Path $RunnerStartStderrPath
  $helper = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput $RunnerStartStdoutPath `
    -RedirectStandardError $RunnerStartStderrPath `
    -PassThru
  $null = $helper.Handle
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
  $launched = @()
  try {
    do {
      Start-Sleep -Milliseconds 100
      $launched = @(Get-ExactRunnerProcess)
      if ($launched.Count -gt 1) {
        throw 'multiple_exact_runner_processes'
      }
      if ($launched.Count -eq 1) {
        break
      }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($launched.Count -ne 1) {
      throw 'runner_start_not_observed'
    }
    if (-not (Wait-SupportAutopilotProcessExit -Process $helper -TimeoutSeconds 5)) {
      Stop-SupportAutopilotProcess -Process $helper
      throw 'runner_start_helper_timeout'
    }
    $helper.Refresh()
    if ($helper.ExitCode -ne 0) {
      throw 'runner_start_helper_failed'
    }
    $helperOutput = Get-Content -LiteralPath $RunnerStartStdoutPath -Raw -Encoding UTF8
    $helperLines = @($helperOutput -split '\r?\n' | Where-Object {
      -not [string]::IsNullOrWhiteSpace($_)
    })
    if ($helperLines.Count -ne 1) {
      throw 'runner_start_helper_output_invalid'
    }
    $helperResult = $helperLines[0] | ConvertFrom-Json
    if (
      $helperResult.started -ne $true -or
      [long]$helperResult.processId -ne [long]$launched[0].ProcessId
    ) {
      throw 'runner_start_helper_pid_mismatch'
    }
  }
  catch {
    $helperFailureOutcome = switch ($_.Exception.Message) {
      'runner_start_helper_timeout' { 'timeout' }
      'runner_start_helper_failed' { 'exit_code' }
      'runner_start_helper_output_invalid' { 'output_invalid' }
      'runner_start_helper_pid_mismatch' { 'pid_mismatch' }
      'support_autopilot_process_stop_failed' { 'stop_failed' }
      default { 'fixed_failure' }
    }
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'runner_start_helper_failed' `
      -Outcome $helperFailureOutcome
    Stop-SupportAutopilotProcess -Process $helper
    throw
  }
  Write-SupportAutopilotRedactedEvent `
    -EventPath $EventPath `
    -EventCode 'runner_start_confirmed' `
    -Outcome 'new_process'
  return [pscustomobject]@{
    heartbeatBaseline = $heartbeatBaseline
    processId = [long]$launched[0].ProcessId
    started = $true
  }
}

function Stop-Runner {
  $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $StopScript -InstallRoot $InstallRoot -NodeExecutable $NodeExecutable
  if ($LASTEXITCODE -ne 0) {
    throw 'runner_stop_failed'
  }
  $result = ($output | Out-String).Trim() | ConvertFrom-Json
  if ($result.stopped -ne $true) {
    throw 'exact_runner_was_not_running'
  }
}

function Wait-PostStopLeaseDrain {
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(15)
  do {
    $health = Get-QueueHealth
    if ([long]$health.activeLeases -eq 0) {
      return $true
    }
    Start-Sleep -Seconds 5
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  return $false
}

function Wait-RunnerReady {
  param([Parameter(Mandatory = $true)]$StartResult)

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
  do {
    Start-Sleep -Seconds 2
    $running = @(Get-ExactRunnerProcess)
    if ($running.Count -eq 1) {
      try {
        $health = Get-QueueHealth
        Assert-QueueGatesReady $health
        $expectedProcess = $StartResult.started -ne $true -or
          [long]$running[0].ProcessId -eq [long]$StartResult.processId
        $heartbeatAdvanced = $StartResult.started -ne $true
        if (
          -not $heartbeatAdvanced -and
          -not [string]::IsNullOrWhiteSpace([string]$health.runnerLastSeenAt)
        ) {
          $heartbeatAdvanced = [string]::IsNullOrWhiteSpace(
            [string]$StartResult.heartbeatBaseline
          ) -or (
            ([DateTimeOffset]$health.runnerLastSeenAt) -gt
            ([DateTimeOffset]$StartResult.heartbeatBaseline)
          )
        }
        if ($expectedProcess -and $heartbeatAdvanced) {
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'runner_readiness_confirmed' `
            -Outcome 'authenticated_post_start_heartbeat'
          return
        }
      }
      catch {
        if (
          $_.Exception.Message -notin @(
            'support_autopilot_health_failed',
            'support_autopilot_gates_not_ready'
          )
        ) {
          throw
        }
      }
    }
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw 'runner_readiness_timeout'
}

function Get-WorkflowSha {
  $sha = (& $GitHubCliPath api "repos/$Repository/git/ref/tags/$WorkflowRef" --jq '.object.sha' 2>$null |
    Out-String).Trim()
  if (
    $LASTEXITCODE -ne 0 -or
    $sha -notmatch '^[0-9a-f]{40}$' -or
    $sha -ne $PinnedWorkflowSha
  ) {
    throw 'workflow_revision_unavailable'
  }
  return $sha
}

function Test-ProductionRunnerAvailable {
  $json = & $GitHubCliPath api "repos/$Repository/actions/runners" 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $false
  }
  try {
    $inventory = ($json | Out-String).Trim() | ConvertFrom-Json
    $matches = @($inventory.runners | Where-Object {
      $_.name -eq $ProductionRunnerName -and
      $_.status -eq 'online' -and
      $_.busy -eq $false
    })
    return $matches.Count -eq 1
  }
  catch {
    return $false
  }
}

function Save-WorkflowInventory {
  $json = & $GitHubCliPath run list `
    --repo $Repository `
    --workflow $Workflow `
    --event workflow_dispatch `
    --limit 100 `
    --json 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion' 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'workflow_inventory_failed'
  }
  [IO.File]::WriteAllText(
    $InventoryPath,
    ($json | Out-String).Trim(),
    [Text.UTF8Encoding]::new($false)
  )
  Set-SupportAutopilotCurrentUserAcl -Path $InventoryPath
}

function Find-CorrelatedWorkflow {
  param(
    [Parameter(Mandatory = $true)][string]$RequestId,
    [Parameter(Mandatory = $true)][string]$ExpectedHeadSha,
    [ValidateRange(1, 15)][int]$WaitMinutes = 5
  )
  $located = $null
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes($WaitMinutes)
  do {
    Save-WorkflowInventory
    $probe = Invoke-SupervisorCommand @(
      'probe-run',
      '--inventory', $InventoryPath,
      '--request-id', $RequestId,
      '--expected-ref', $WorkflowRef,
      '--expected-sha', $ExpectedHeadSha
    )
    $foundProperty = $probe.PSObject.Properties['found']
    if ($null -ne $foundProperty -and $foundProperty.Value -eq $false) {
      $located = $null
    }
    else {
      $located = $probe
    }
    if ($null -eq $located) {
      Start-Sleep -Seconds 5
    }
  } while ($null -eq $located -and [DateTimeOffset]::UtcNow -lt $deadline)
  return $located
}

function Complete-CorrelatedWorkflow {
  param(
    [Parameter(Mandatory = $true)][string]$RequestId,
    [Parameter(Mandatory = $true)][string]$ExpectedHeadSha,
    [Parameter(Mandatory = $true)][long]$WorkflowRunId
  )
  $located = Find-CorrelatedWorkflow `
    -RequestId $RequestId `
    -ExpectedHeadSha $ExpectedHeadSha `
    -WaitMinutes 5
  if ($null -eq $located -or [long]$located.workflowRunId -ne $WorkflowRunId) {
    throw 'correlated_workflow_changed'
  }
  $queueDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
  $overallDeadline = [DateTimeOffset]::UtcNow.AddMinutes(20)
  $cancelRequested = $false
  do {
    Save-WorkflowInventory
    $current = Invoke-SupervisorCommand @(
      'locate-run',
      '--inventory', $InventoryPath,
      '--request-id', $RequestId,
      '--expected-ref', $WorkflowRef,
      '--expected-sha', $ExpectedHeadSha
    )
    if ([long]$current.workflowRunId -ne $WorkflowRunId) {
      throw 'correlated_workflow_changed'
    }
    if ([string]$current.status -eq 'completed') {
      try {
        $completed = Invoke-SupervisorCommand @(
          'select-run',
          '--inventory', $InventoryPath,
          '--request-id', $RequestId,
          '--expected-ref', $WorkflowRef,
          '--expected-sha', $ExpectedHeadSha
        )
      }
      catch {
        throw 'correlated_workflow_failed'
      }
      if ([long]$completed.workflowRunId -ne $WorkflowRunId) {
        throw 'correlated_workflow_changed'
      }
      return $WorkflowRunId
    }
    $now = [DateTimeOffset]::UtcNow
    $queueTimedOut = [string]$current.status -eq 'queued' -and $now -ge $queueDeadline
    $overallTimedOut = $now -ge $overallDeadline
    if ($queueTimedOut -and -not $cancelRequested) {
      & $GitHubCliPath run cancel ([string]$WorkflowRunId) --repo $Repository 2>$null |
        Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw 'correlated_workflow_cancel_failed'
      }
      $cancelRequested = $true
      $overallDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
    }
    elseif ($overallTimedOut) {
      throw 'correlated_workflow_ambiguous'
    }
    Start-Sleep -Seconds 5
  } while ($true)
}

function Assert-CandidateDigest {
  param(
    [Parameter(Mandatory = $true)][string]$CandidatePath,
    [Parameter(Mandatory = $true)][string]$Digest
  )
  Invoke-SupervisorCommand @(
    'verify-candidate',
    '--candidate-path', $CandidatePath,
    '--digest', $Digest
  ) | Out-Null
}

if ($PlanOnly) {
  [pscustomobject]@{
    action = 'credential-supervisor'
    forceRotation = [bool]$ForceRotation
    installRoot = $InstallRoot
    planOnly = $true
    stateExists = Test-Path -LiteralPath $StatePath -PathType Leaf
    workflowRef = $WorkflowRef
  } | ConvertTo-Json -Compress
  exit 0
}
if ($ForceRotation -and $ConfirmForceRotation -ne 'rotate-support-autopilot-credential') {
  throw 'force_rotation_not_confirmed'
}

foreach ($requiredPath in @(
  $NodeExecutable,
  $SecurityScript,
  $SupervisorMain,
  $HealthMain,
  $RunnerEntryPoint,
  $StartScript,
  $StopScript,
  $CredentialGenerator,
  $StatePath,
  $ActiveCredentialPath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw 'required_supervisor_file_missing'
  }
}
if ($null -eq (Get-Command $GitHubCliPath -ErrorAction SilentlyContinue)) {
  throw 'github_cli_unavailable'
}

$lockStream = $null
try {
  Set-SupportAutopilotCurrentUserAcl -Path $StateRoot -Container
  Set-SupportAutopilotCurrentUserAcl -Path $StatePath
  $lockDeadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
  do {
    try {
      $lockStream = [IO.File]::Open(
        $LockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
      )
    }
    catch [IO.IOException] {
      Start-Sleep -Milliseconds 500
    }
  } while ($null -eq $lockStream -and [DateTimeOffset]::UtcNow -lt $lockDeadline)
  if ($null -eq $lockStream) {
    throw 'credential_rotation_lock_unavailable'
  }
  try {
    Assert-NoSupportAutopilotPlaintextTokenEnvironment
  }
  catch {
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'credential_rotation_blocked' `
      -Outcome 'plaintext_environment'
    throw 'plaintext_token_environment_present'
  }

  $decisionArguments = @(
    'decision',
    '--state', $StatePath,
    '--credential-root', $CredentialRoot
  )
  $decision = Invoke-SupervisorCommand $decisionArguments
  $expiredRecovery = $decision.expired -eq $true
  $seedRequired = $decision.PSObject.Properties['seedRequired']
  if ($null -ne $seedRequired -and $seedRequired.Value -eq $true) {
    throw 'credential_state_seed_required'
  }
  if (-not $decision.pendingRotation -and -not $decision.rotate -and -not $ForceRotation) {
    $runnerStart = Start-Runner
    Wait-RunnerReady -StartResult $runnerStart
    Write-SupportAutopilotRedactedEvent `
      -EventPath $EventPath `
      -EventCode 'credential_supervisor_healthy' `
      -Outcome 'no_rotation_due'
    [pscustomobject]@{ outcome = 'healthy'; rotated = $false } |
      ConvertTo-Json -Compress
    exit 0
  }

  $state = Get-RotationState
  $auditedWorkflowSha = $null
  $candidateCreatedThisRun = $false
  $dispatchPreparedThisRun = $false
  while ($true) {
    if ($null -eq $state.pendingRotation) {
      if (-not (Test-ProductionRunnerAvailable)) {
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'credential_rotation_deferred' `
          -Outcome 'production_runner_unavailable'
        [pscustomobject]@{
          outcome = 'deferred_production_runner_unavailable'
          rotated = $false
        } | ConvertTo-Json -Compress
        exit 0
      }
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_precheck' `
        -Outcome 'production_runner_available'
      $auditedWorkflowSha = Get-WorkflowSha

      if ($expiredRecovery) {
        $running = @(Get-ExactRunnerProcess)
        if ($running.Count -gt 1) {
          throw 'multiple_exact_runner_processes'
        }
        if ($running.Count -eq 1) {
          Stop-Runner
        }
        $leaseGraceEndsAt = ([DateTimeOffset]$state.activeCredential.expiresAt).AddMinutes(
          $ExpiredLeaseGraceMinutes
        )
        if ([DateTimeOffset]::UtcNow -lt $leaseGraceEndsAt) {
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'credential_rotation_deferred' `
            -Outcome 'expired_lease_grace'
          [pscustomobject]@{
            outcome = 'deferred_expired_lease_grace'
            rotated = $false
          } | ConvertTo-Json -Compress
          exit 0
        }
      }
      else {
        $health = Get-QueueHealth
        Assert-QueueGatesReady $health
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'credential_rotation_precheck' `
          -Outcome 'queue_gates_ready'
        if ([long]$health.activeLeases -ne 0) {
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'credential_rotation_deferred' `
            -Outcome 'active_lease' `
            -ActiveLeases ([long]$health.activeLeases)
          [pscustomobject]@{
            activeLeases = [long]$health.activeLeases
            outcome = 'deferred_active_work'
            rotated = $false
          } | ConvertTo-Json -Compress
          exit 0
        }
        if (@(Get-ExactRunnerProcess).Count -ne 1) {
          throw 'exact_runner_process_missing'
        }
        Stop-Runner
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'credential_rotation_precheck' `
          -Outcome 'runner_drained'
        if (-not (Wait-PostStopLeaseDrain)) {
          $runnerStart = Start-Runner
          Wait-RunnerReady -StartResult $runnerStart
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'credential_rotation_deferred' `
            -Outcome 'post_stop_active_lease'
          [pscustomobject]@{
            outcome = 'deferred_post_stop_active_work'
            rotated = $false
          } | ConvertTo-Json -Compress
          exit 0
        }
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'credential_rotation_precheck' `
          -Outcome 'post_stop_no_active_lease'
      }
      $requestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'runner_stopped'
        requestId = $requestId
      }))
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId $requestId `
        -Stage 'runner_stopped'
      $state = Get-RotationState
      continue
    }

    $pending = $state.pendingRotation
    $recovery = Invoke-SupervisorCommand @(
      'recovery-action',
      '--state', $StatePath,
      '--credential-root', $CredentialRoot,
      '--active-path', $ActiveCredentialPath
    )
    if ($pending.stage -eq 'runner_stopped') {
      $candidatePath = Join-Path $CredentialRoot ("candidate-$($pending.requestId).dpapi")
      $metadataPath = Join-Path $StateRoot ("candidate-$($pending.requestId).json")
      if ($recovery.action -eq 'remove_orphan_candidate') {
        Remove-Item -LiteralPath $candidatePath -Force
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'orphan_candidate_removed' `
          -RequestId ([string]$pending.requestId) `
          -Stage 'runner_stopped'
      }
      elseif ($recovery.action -ne 'generate_candidate') {
        throw 'unexpected_runner_stopped_recovery_action'
      }
      try {
        $metadataJson = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
          -File $CredentialGenerator -OutputPath $candidatePath
        if ($LASTEXITCODE -ne 0) {
          throw 'candidate_generation_failed'
        }
        [IO.File]::WriteAllText(
          $metadataPath,
          ($metadataJson | Out-String).Trim(),
          [Text.UTF8Encoding]::new($false)
        )
        Set-SupportAutopilotCurrentUserAcl -Path $metadataPath
        Invoke-SupervisorCommand @(
          'validate-generated',
          '--metadata', $metadataPath
        ) | Out-Null
        $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 |
          ConvertFrom-Json
      }
      finally {
        if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
          Remove-Item -LiteralPath $metadataPath -Force
        }
      }
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'candidate_ready'
        requestId = [string]$pending.requestId
        candidatePath = $candidatePath
        tokenSha256 = [string]$metadata.tokenSha256
        issuedAt = [string]$metadata.issuedAt
        expiresAt = [string]$metadata.expiresAt
      }))
      $candidateCreatedThisRun = $true
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId ([string]$pending.requestId) `
        -Stage 'candidate_ready'
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'candidate_ready') {
      if ($recovery.action -eq 'restart_with_fresh_candidate') {
        $replacementRequestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
        Write-RotationState (New-StateForStage $state ([ordered]@{
          stage = 'runner_stopped'
          requestId = $replacementRequestId
        }))
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'candidate_recovery_started' `
          -RequestId $replacementRequestId `
          -Outcome 'missing_before_dispatch'
        $state = Get-RotationState
        continue
      }
      if ($recovery.action -ne 'prepare_dispatch') {
        throw 'unexpected_candidate_ready_recovery_action'
      }
      Assert-CandidateDigest `
        -CandidatePath ([string]$pending.candidatePath) `
        -Digest ([string]$pending.tokenSha256)
      $expectedHeadSha = if ($null -ne $auditedWorkflowSha) {
        $auditedWorkflowSha
      }
      else {
        Get-WorkflowSha
      }
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'dispatch_prepared'
        requestId = [string]$pending.requestId
        candidatePath = [string]$pending.candidatePath
        tokenSha256 = [string]$pending.tokenSha256
        issuedAt = [string]$pending.issuedAt
        expiresAt = [string]$pending.expiresAt
        expectedHeadSha = $expectedHeadSha
      }))
      $dispatchPreparedThisRun = $candidateCreatedThisRun
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId ([string]$pending.requestId) `
        -Stage 'dispatch_prepared'
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'dispatch_prepared') {
      if ($recovery.action -eq 'restart_with_fresh_candidate') {
        $replacementRequestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
        Write-RotationState (New-StateForStage $state ([ordered]@{
          stage = 'runner_stopped'
          requestId = $replacementRequestId
        }))
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'candidate_recovery_started' `
          -RequestId $replacementRequestId `
          -Outcome 'missing_before_dispatch'
        $state = Get-RotationState
        continue
      }
      if ($recovery.action -ne 'inspect_correlated_workflow') {
        throw 'unexpected_dispatch_prepared_recovery_action'
      }
      Assert-CandidateDigest `
        -CandidatePath ([string]$pending.candidatePath) `
        -Digest ([string]$pending.tokenSha256)

      $located = $null
      if (-not $dispatchPreparedThisRun) {
        $located = Find-CorrelatedWorkflow `
          -RequestId ([string]$pending.requestId) `
          -ExpectedHeadSha ([string]$pending.expectedHeadSha) `
          -WaitMinutes 5
      }
      if ($null -eq $located) {
        & $GitHubCliPath workflow run $Workflow `
        --repo $Repository `
        --ref $WorkflowRef `
        -f 'action=enable' `
        -f "request_id=$($pending.requestId)" `
        -f "token_sha256=$($pending.tokenSha256)" `
        -f "issued_at=$($pending.issuedAt)" `
        -f "expires_at=$($pending.expiresAt)" `
        -f 'confirm=enable-support-autopilot-credential' 2>$null
        if ($LASTEXITCODE -ne 0) {
          throw 'workflow_dispatch_failed'
        }
        $located = Find-CorrelatedWorkflow `
          -RequestId ([string]$pending.requestId) `
          -ExpectedHeadSha ([string]$pending.expectedHeadSha) `
          -WaitMinutes 5
      }
      if ($null -eq $located) {
        throw 'correlated_workflow_not_found'
      }
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'workflow_dispatched'
        requestId = [string]$pending.requestId
        candidatePath = [string]$pending.candidatePath
        tokenSha256 = [string]$pending.tokenSha256
        issuedAt = [string]$pending.issuedAt
        expiresAt = [string]$pending.expiresAt
        expectedHeadSha = [string]$pending.expectedHeadSha
        workflowRunId = [long]$located.workflowRunId
      }))
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId ([string]$pending.requestId) `
        -Stage 'workflow_dispatched' `
        -WorkflowRunId ([long]$located.workflowRunId)
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'workflow_dispatched') {
      if ($recovery.action -ne 'complete_correlated_workflow') {
        throw 'unexpected_workflow_recovery_action'
      }
      try {
        $workflowRunId = Complete-CorrelatedWorkflow `
          -RequestId ([string]$pending.requestId) `
          -ExpectedHeadSha ([string]$pending.expectedHeadSha) `
          -WorkflowRunId ([long]$pending.workflowRunId)
      }
      catch {
        if ($_.Exception.Message -ne 'correlated_workflow_failed') {
          throw
        }
        if ($expiredRecovery) {
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'credential_rotation_recovered' `
            -RequestId ([string]$pending.requestId) `
            -Outcome 'remote_failed_expired_preserved'
          throw 'expired_workflow_failure_requires_recovery'
        }
        Get-QueueHealth | Out-Null
        if (Test-Path -LiteralPath $pending.candidatePath -PathType Leaf) {
          Remove-Item -LiteralPath $pending.candidatePath -Force
        }
        Write-RotationState (New-StateForStage $state $null)
        $runnerStart = Start-Runner
        Wait-RunnerReady -StartResult $runnerStart
        Write-SupportAutopilotRedactedEvent `
          -EventPath $EventPath `
          -EventCode 'credential_rotation_recovered' `
          -RequestId ([string]$pending.requestId) `
          -Outcome 'remote_failed_local_active'
        [pscustomobject]@{
          outcome = 'remote_failed_local_recovered'
          rotated = $false
        } | ConvertTo-Json -Compress
        exit 0
      }
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'server_accepted'
        requestId = [string]$pending.requestId
        candidatePath = [string]$pending.candidatePath
        tokenSha256 = [string]$pending.tokenSha256
        issuedAt = [string]$pending.issuedAt
        expiresAt = [string]$pending.expiresAt
        expectedHeadSha = [string]$pending.expectedHeadSha
        workflowRunId = $workflowRunId
      }))
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId ([string]$pending.requestId) `
        -Stage 'server_accepted' `
        -WorkflowRunId ([long]$workflowRunId)
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'server_accepted') {
      if ($recovery.action -eq 'promote_candidate') {
        Assert-CandidateDigest `
          -CandidatePath ([string]$pending.candidatePath) `
          -Digest ([string]$pending.tokenSha256)
        if (Test-Path -LiteralPath $ActiveCredentialPath -PathType Leaf) {
          if (Test-Path -LiteralPath $RollbackCredentialPath -PathType Leaf) {
            Remove-Item -LiteralPath $RollbackCredentialPath -Force
          }
          [IO.File]::Replace(
            [string]$pending.candidatePath,
            $ActiveCredentialPath,
            $RollbackCredentialPath
          )
        }
        else {
          Move-Item -LiteralPath $pending.candidatePath -Destination $ActiveCredentialPath
        }
      }
      elseif ($recovery.action -eq 'rotate_fresh_candidate') {
          $replacementRequestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
          Write-RotationState (New-StateForStage $state ([ordered]@{
            stage = 'runner_stopped'
            requestId = $replacementRequestId
          }))
          Write-SupportAutopilotRedactedEvent `
            -EventPath $EventPath `
            -EventCode 'candidate_recovery_started' `
            -RequestId $replacementRequestId `
            -Outcome 'missing_after_server_acceptance'
          $state = Get-RotationState
          continue
      }
      elseif ($recovery.action -eq 'finalize_existing_promotion') {
        Assert-CandidateDigest `
          -CandidatePath $ActiveCredentialPath `
          -Digest ([string]$pending.tokenSha256)
      }
      else {
        throw 'unexpected_server_accepted_recovery_action'
      }
      Set-SupportAutopilotCurrentUserAcl -Path $ActiveCredentialPath
      if (Test-Path -LiteralPath $RollbackCredentialPath -PathType Leaf) {
        Set-SupportAutopilotCurrentUserAcl -Path $RollbackCredentialPath
      }
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'candidate_promoted'
        requestId = [string]$pending.requestId
        candidatePath = [string]$pending.candidatePath
        tokenSha256 = [string]$pending.tokenSha256
        issuedAt = [string]$pending.issuedAt
        expiresAt = [string]$pending.expiresAt
        expectedHeadSha = [string]$pending.expectedHeadSha
        workflowRunId = [long]$pending.workflowRunId
      }))
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_stage' `
        -RequestId ([string]$pending.requestId) `
        -Stage 'candidate_promoted' `
        -WorkflowRunId ([long]$pending.workflowRunId)
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'candidate_promoted') {
      if ($recovery.action -ne 'verify_and_start') {
        throw 'unexpected_candidate_promoted_recovery_action'
      }
      Assert-CandidateDigest `
        -CandidatePath $ActiveCredentialPath `
        -Digest ([string]$pending.tokenSha256)
      $runnerStart = Start-Runner -PromotionMode
      Wait-RunnerReady -StartResult $runnerStart
      $finalState = [ordered]@{
        schemaVersion = 1
        activeCredential = [ordered]@{
          issuedAt = [string]$pending.issuedAt
          expiresAt = [string]$pending.expiresAt
        }
        pendingRotation = $null
        updatedAt = ConvertTo-CanonicalUtc
      }
      Write-RotationState $finalState
      Write-SupportAutopilotRedactedEvent `
        -EventPath $EventPath `
        -EventCode 'credential_rotation_completed' `
        -RequestId ([string]$pending.requestId) `
        -Outcome 'rotated' `
        -WorkflowRunId ([long]$pending.workflowRunId)
      [pscustomobject]@{
        outcome = 'rotated'
        rotated = $true
        workflowRunId = [long]$pending.workflowRunId
      } | ConvertTo-Json -Compress
      exit 0
    }

    throw 'unsupported_rotation_stage'
  }
}
finally {
  if (Test-Path -LiteralPath $InventoryPath -PathType Leaf) {
    Remove-Item -LiteralPath $InventoryPath -Force
  }
  if ($null -ne $lockStream) {
    $lockStream.Dispose()
  }
}
