[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE '.sdelka-support-autopilot'),
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$AdminMcpRoot = Join-Path $InstallRoot 'admin-mcp'
$WatchdogScript = Join-Path $AdminMcpRoot 'scripts\start-support-autopilot-shadow-runner.ps1'
$SupervisorScript = Join-Path $AdminMcpRoot 'scripts\invoke-support-autopilot-credential-supervisor.ps1'
$WatchdogTaskName = 'Sdelka Support Autopilot Watchdog'
$SupervisorTaskName = 'Sdelka Support Autopilot Credential Supervisor'
$CurrentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Escape-Xml {
  param([Parameter(Mandatory = $true)][string]$Value)
  return [Security.SecurityElement]::Escape($Value)
}

function New-TaskXml {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$Interval,
    [Parameter(Mandatory = $true)][string]$ExecutionTimeLimit
  )
  $startBoundary = [DateTime]::Now.AddMinutes(1).ToString('s')
  $encodedSid = Escape-Xml $CurrentUserSid
  $encodedWorkingDirectory = Escape-Xml $AdminMcpRoot
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $ScriptPath + '" -InstallRoot "' + $InstallRoot + '"'
  $encodedArguments = Escape-Xml $arguments
  return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$encodedSid</UserId>
    </LogonTrigger>
    <CalendarTrigger>
      <Repetition>
        <Interval>$Interval</Interval>
        <Duration>P1D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$encodedSid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>$ExecutionTimeLimit</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$encodedArguments</Arguments>
      <WorkingDirectory>$encodedWorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

$definitions = @(
  [pscustomobject]@{
    interval = 'PT5M'
    name = $WatchdogTaskName
    script = $WatchdogScript
    timeLimit = 'PT5M'
  },
  [pscustomobject]@{
    interval = 'PT1H'
    name = $SupervisorTaskName
    script = $SupervisorScript
    timeLimit = 'PT50M'
  }
)

if ($PlanOnly) {
  foreach ($definition in $definitions) {
    [xml](New-TaskXml `
      -ScriptPath $definition.script `
      -Interval $definition.interval `
      -ExecutionTimeLimit $definition.timeLimit) | Out-Null
  }
  [pscustomobject]@{
    currentUserSid = $CurrentUserSid
    planOnly = $true
    tasks = @($definitions | ForEach-Object {
      [pscustomobject]@{ interval = $_.interval; name = $_.name; script = $_.script }
    })
  } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

foreach ($definition in $definitions) {
  if (-not (Test-Path -LiteralPath $definition.script -PathType Leaf)) {
    throw 'scheduled task script is missing'
  }
  $xml = New-TaskXml `
    -ScriptPath $definition.script `
    -Interval $definition.interval `
    -ExecutionTimeLimit $definition.timeLimit
  Register-ScheduledTask -TaskName $definition.name -Xml $xml -Force | Out-Null
}

[pscustomobject]@{
  installed = $true
  taskNames = @($definitions.name)
} | ConvertTo-Json -Compress
