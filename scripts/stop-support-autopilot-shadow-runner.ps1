[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [ValidateRange(1, 1800)]
  [int]$StopTimeoutSeconds = 720,
  [switch]$ForceAfterTimeout,
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
$EntryPoint = Join-Path $InstallRoot 'admin-mcp\dist\runner\support-autopilot-shadow-main.js'
$StateRoot = Join-Path $InstallRoot 'state'
$DrainRequestPath = Join-Path $StateRoot 'shadow-runner.drain'
$SecurityScript = Join-Path $PSScriptRoot 'support-autopilot-windows-security.ps1'
. $SecurityScript

function Get-SupportAutopilotRunnerProcess {
  $pattern = '^\s*"?' + [regex]::Escape($NodeExecutable) + '"?\s+"?' +
    [regex]::Escape($EntryPoint) + '"?\s*$'
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.ExecutablePath -ieq $NodeExecutable -and
      $_.CommandLine -match $pattern
    })
}

$running = @(Get-SupportAutopilotRunnerProcess)
$runningProcessIds = @($running | ForEach-Object { $_.ProcessId })
if ($PlanOnly) {
  [pscustomobject]@{
    action = 'stop'
    matchingProcessIds = $runningProcessIds
    planOnly = $true
    stopTimeoutSeconds = $StopTimeoutSeconds
  } | ConvertTo-Json -Compress
  exit 0
}
if ($running.Count -eq 0) {
  [pscustomobject]@{ reason = 'not_running'; stopped = $false } |
    ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $StateRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}
Set-SupportAutopilotCurrentUserAcl -Path $StateRoot -Container
[IO.File]::WriteAllText(
  $DrainRequestPath,
  (([ordered]@{ requestedAt = [DateTime]::UtcNow.ToString('o') }) | ConvertTo-Json -Compress),
  [Text.UTF8Encoding]::new($false)
)
Set-SupportAutopilotCurrentUserAcl -Path $DrainRequestPath

$deadline = [DateTime]::UtcNow.AddSeconds($StopTimeoutSeconds)
do {
  Start-Sleep -Milliseconds 250
  $remaining = @(Get-SupportAutopilotRunnerProcess)
} while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)

if ($remaining.Count -gt 0) {
  if (-not $ForceAfterTimeout) {
    throw 'runner_graceful_stop_timeout'
  }
  foreach ($process in $remaining) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  $forceDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = @(Get-SupportAutopilotRunnerProcess)
  } while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $forceDeadline)
  if ($remaining.Count -gt 0) {
    throw 'runner_stop_timeout'
  }
}
[pscustomobject]@{
  processIds = $runningProcessIds
  stopped = $true
} | ConvertTo-Json -Compress
