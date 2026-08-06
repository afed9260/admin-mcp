[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [switch]$ForceRotation,
  [string]$ConfirmForceRotation = '',
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repository = 'afed9260/ai-agent-backend'
$Workflow = 'support-autopilot-credential-rotation.yml'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
$AdminMcpRoot = Join-Path $InstallRoot 'admin-mcp'
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
  try {
    $json = $State | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
    Invoke-SupervisorCommand @(
      'validate-state',
      '--state', $temporaryPath,
      '--credential-root', $CredentialRoot
    ) | Out-Null
    if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
      [IO.File]::Replace($temporaryPath, $StatePath, $null)
    }
    else {
      Move-Item -LiteralPath $temporaryPath -Destination $StatePath
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
  Remove-Item Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_API_TOKEN -ErrorAction SilentlyContinue
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
  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', $StartScript,
    '-InstallRoot', $InstallRoot,
    '-NodeExecutable', $NodeExecutable,
    '-SupervisorOwnedLock'
  )
  if ($PromotionMode) {
    $arguments += '-AllowPendingPromotion'
  }
  $output = & powershell.exe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw 'runner_start_failed'
  }
  $result = ($output | Out-String).Trim() | ConvertFrom-Json
  if ($result.started -ne $true -and $result.reason -ne 'already_running') {
    throw 'runner_start_refused'
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

function Wait-RunnerReady {
  $readyEvent = '"eventCode":"shadow_runner_ready"'
  $stderrPath = Join-Path $StateRoot 'shadow-runner.stderr.log'
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
  do {
    Start-Sleep -Seconds 2
    $running = @(Get-ExactRunnerProcess)
    $readyLogged = $false
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      try {
        $readyLogged = [IO.File]::ReadAllText($stderrPath).Contains($readyEvent)
      }
      catch [IO.IOException] {
        $readyLogged = $false
      }
    }
    if ($running.Count -eq 1 -and $readyLogged) {
      Get-QueueHealth | Out-Null
      return
    }
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw 'runner_readiness_timeout'
}

function Get-MainSha {
  $sha = (& gh.exe api "repos/$Repository/git/ref/heads/main" --jq '.object.sha' 2>$null |
    Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') {
    throw 'main_revision_unavailable'
  }
  return $sha
}

function Save-WorkflowInventory {
  $json = & gh.exe run list `
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
}

function Wait-CorrelatedWorkflow {
  param(
    [Parameter(Mandatory = $true)][string]$RequestId,
    [Parameter(Mandatory = $true)][string]$ExpectedHeadSha
  )
  $located = $null
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
  do {
    Save-WorkflowInventory
    try {
      $located = Invoke-SupervisorCommand @(
        'locate-run',
        '--inventory', $InventoryPath,
        '--request-id', $RequestId,
        '--expected-sha', $ExpectedHeadSha
      )
    }
    catch {
      $located = $null
    }
    if ($null -eq $located) {
      Start-Sleep -Seconds 5
    }
  } while ($null -eq $located -and [DateTimeOffset]::UtcNow -lt $deadline)
  if ($null -eq $located) {
    throw 'correlated_workflow_not_found'
  }

  & gh.exe run watch ([string]$located.workflowRunId) --repo $Repository --exit-status 2>$null |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'correlated_workflow_failed'
  }
  Save-WorkflowInventory
  $completed = Invoke-SupervisorCommand @(
    'select-run',
    '--inventory', $InventoryPath,
    '--request-id', $RequestId,
    '--expected-sha', $ExpectedHeadSha
  )
  if ([long]$completed.workflowRunId -ne [long]$located.workflowRunId) {
    throw 'correlated_workflow_changed'
  }
  return [long]$completed.workflowRunId
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
  } | ConvertTo-Json -Compress
  exit 0
}
if ($ForceRotation -and $ConfirmForceRotation -ne 'rotate-support-autopilot-credential') {
  throw 'force_rotation_not_confirmed'
}

foreach ($requiredPath in @(
  $NodeExecutable,
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
if ($null -eq (Get-Command gh.exe -ErrorAction SilentlyContinue)) {
  throw 'github_cli_unavailable'
}

$lockStream = $null
try {
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

  $decisionArguments = @(
    'decision',
    '--state', $StatePath,
    '--credential-root', $CredentialRoot
  )
  $decision = Invoke-SupervisorCommand $decisionArguments
  $seedRequired = $decision.PSObject.Properties['seedRequired']
  if ($null -ne $seedRequired -and $seedRequired.Value -eq $true) {
    throw 'credential_state_seed_required'
  }
  if (-not $decision.pendingRotation -and -not $decision.rotate -and -not $ForceRotation) {
    Start-Runner
    Wait-RunnerReady
    [pscustomobject]@{ outcome = 'healthy'; rotated = $false } |
      ConvertTo-Json -Compress
    exit 0
  }

  $state = Get-RotationState
  while ($true) {
    if ($null -eq $state.pendingRotation) {
      $health = Get-QueueHealth
      if ([long]$health.activeLeases -ne 0) {
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
      $requestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'runner_stopped'
        requestId = $requestId
      }))
      $state = Get-RotationState
      continue
    }

    $pending = $state.pendingRotation
    if ($pending.stage -eq 'runner_stopped') {
      $candidatePath = Join-Path $CredentialRoot ("candidate-$($pending.requestId).dpapi")
      $metadataPath = Join-Path $StateRoot ("candidate-$($pending.requestId).json")
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
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'candidate_ready') {
      $expectedHeadSha = Get-MainSha
      Write-RotationState (New-StateForStage $state ([ordered]@{
        stage = 'workflow_dispatched'
        requestId = [string]$pending.requestId
        candidatePath = [string]$pending.candidatePath
        tokenSha256 = [string]$pending.tokenSha256
        issuedAt = [string]$pending.issuedAt
        expiresAt = [string]$pending.expiresAt
        expectedHeadSha = $expectedHeadSha
        workflowRunId = $null
      }))
      & gh.exe workflow run $Workflow `
        --repo $Repository `
        --ref main `
        -f 'action=enable' `
        -f "request_id=$($pending.requestId)" `
        -f "token_sha256=$($pending.tokenSha256)" `
        -f "issued_at=$($pending.issuedAt)" `
        -f "expires_at=$($pending.expiresAt)" `
        -f 'confirm=enable-support-autopilot-credential' 2>$null
      if ($LASTEXITCODE -ne 0) {
        throw 'workflow_dispatch_failed'
      }
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'workflow_dispatched') {
      try {
        $workflowRunId = Wait-CorrelatedWorkflow `
          -RequestId ([string]$pending.requestId) `
          -ExpectedHeadSha ([string]$pending.expectedHeadSha)
      }
      catch {
        if ($_.Exception.Message -ne 'correlated_workflow_failed') {
          throw
        }
        Get-QueueHealth | Out-Null
        if (Test-Path -LiteralPath $pending.candidatePath -PathType Leaf) {
          Remove-Item -LiteralPath $pending.candidatePath -Force
        }
        Write-RotationState (New-StateForStage $state $null)
        Start-Runner
        Wait-RunnerReady
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
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'server_accepted') {
      if (Test-Path -LiteralPath $pending.candidatePath -PathType Leaf) {
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
      else {
        Assert-CandidateDigest `
          -CandidatePath $ActiveCredentialPath `
          -Digest ([string]$pending.tokenSha256)
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
      $state = Get-RotationState
      continue
    }

    if ($pending.stage -eq 'candidate_promoted') {
      Assert-CandidateDigest `
        -CandidatePath $ActiveCredentialPath `
        -Digest ([string]$pending.tokenSha256)
      Start-Runner -PromotionMode
      Wait-RunnerReady
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
