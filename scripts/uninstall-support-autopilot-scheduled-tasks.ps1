[CmdletBinding()]
param([switch]$PlanOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskNames = @(
  'Sdelka Support Autopilot Watchdog',
  'Sdelka Support Autopilot Credential Supervisor'
)

if ($PlanOnly) {
  [pscustomobject]@{ planOnly = $true; taskNames = $taskNames } |
    ConvertTo-Json -Compress
  exit 0
}

$removed = @()
foreach ($taskName in $taskNames) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    $removed += $taskName
  }
}

[pscustomobject]@{ removed = $removed } | ConvertTo-Json -Compress
