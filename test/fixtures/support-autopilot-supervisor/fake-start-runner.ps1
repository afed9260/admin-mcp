param(
  [string]$InstallRoot,
  [string]$NodeExecutable,
  [switch]$SupervisorOwnedLock,
  [switch]$AllowPendingPromotion
)

$ErrorActionPreference = 'Stop'
$entryPoint = Join-Path $InstallRoot 'admin-mcp\dist\runner\support-autopilot-shadow-main.js'
$stateRoot = Join-Path $InstallRoot 'state'
$drainPath = Join-Path $stateRoot 'shadow-runner.drain'
$stdoutPath = Join-Path $stateRoot 'shadow-runner.stdout.log'
$stderrPath = Join-Path $stateRoot 'shadow-runner.stderr.log'
if (Test-Path -LiteralPath $drainPath -PathType Leaf) {
  Remove-Item -LiteralPath $drainPath -Force
}
[IO.File]::WriteAllText($stdoutPath, '', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(
  $stderrPath,
  '{"eventCode":"shadow_runner_ready"}',
  [Text.UTF8Encoding]::new($false)
)
$env:SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH = $drainPath
$quotedEntryPoint = '"' + $entryPoint + '"'
$process = Start-Process -FilePath $NodeExecutable -ArgumentList @($quotedEntryPoint) -WorkingDirectory (Split-Path -Parent $entryPoint) -WindowStyle Hidden -PassThru
[pscustomobject]@{ processId = $process.Id; started = $true } | ConvertTo-Json -Compress
