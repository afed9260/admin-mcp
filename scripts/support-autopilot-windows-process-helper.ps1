function Wait-SupportAutopilotProcessExit {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $Process.Refresh()
    if ($Process.HasExited) {
      $Process.WaitForExit()
      return $true
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  $Process.Refresh()
  if ($Process.HasExited) {
    $Process.WaitForExit()
    return $true
  }
  return $false
}

function Stop-SupportAutopilotProcess {
  param([Parameter(Mandatory = $true)]$Process)
  $Process.Refresh()
  if ($Process.HasExited) {
    $Process.WaitForExit()
    return
  }
  Stop-Process -Id $Process.Id
  if (-not (Wait-SupportAutopilotProcessExit -Process $Process -TimeoutSeconds 5)) {
    throw 'support_autopilot_process_stop_failed'
  }
}
