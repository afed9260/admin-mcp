[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [string]$NodeExecutable = '',
  [ValidateRange(1, 120)]
  [int]$StopTimeoutSeconds = 30,
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

foreach ($process in $running) {
  Stop-Process -Id $process.ProcessId -ErrorAction Stop
}
$deadline = [DateTime]::UtcNow.AddSeconds($StopTimeoutSeconds)
do {
  Start-Sleep -Milliseconds 250
  $remaining = @(Get-SupportAutopilotRunnerProcess)
} while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)

if ($remaining.Count -gt 0) {
  throw 'runner_stop_timeout'
}
[pscustomobject]@{
  processIds = $runningProcessIds
  stopped = $true
} | ConvertTo-Json -Compress
