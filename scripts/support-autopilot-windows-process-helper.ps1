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

function Stop-SupportAutopilotPostTimeoutChildren {
  param(
    [AllowEmptyCollection()][long[]]$BaselineProcessIds = @(),
    [Parameter(Mandatory = $true)][scriptblock]$GetProcesses,
    [Parameter(Mandatory = $true)][scriptblock]$StopProcesses,
    [ValidateRange(100, 10000)][int]$SettleMilliseconds = 2000
  )
  $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($SettleMilliseconds)
  $contained = $false
  do {
    $current = @(& $GetProcesses)
    $newProcesses = @($current | Where-Object {
      [long]$_.ProcessId -notin $BaselineProcessIds
    })
    if ($newProcesses.Count -gt 0) {
      & $StopProcesses $newProcesses
      $contained = $true
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  $remaining = @(& $GetProcesses | Where-Object {
    [long]$_.ProcessId -notin $BaselineProcessIds
  })
  if ($remaining.Count -gt 0) {
    throw 'support_autopilot_post_timeout_child_survived'
  }
  return $contained
}
