Set-StrictMode -Version Latest

$script:SupportAutopilotEventFileName = 'credential-rotation.events.jsonl'

function Set-SupportAutopilotCurrentUserAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$Container
  )

  $resolvedPath = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolvedPath)) {
    throw 'support_autopilot_acl_target_missing'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $account = [Security.Principal.NTAccount]::new($identity)
  if ($Container) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
  }
  else {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    $propagation = [Security.AccessControl.PropagationFlags]::None
  }
  $acl.SetOwner($account)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $account,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    $propagation,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $resolvedPath -AclObject $acl
}

function Assert-NoSupportAutopilotPlaintextTokenEnvironment {
  if (
    (Test-Path Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN) -or
    (Test-Path Env:ADMIN_API_TOKEN)
  ) {
    throw 'plaintext_token_environment_present'
  }
}

function Write-SupportAutopilotRedactedEvent {
  param(
    [Parameter(Mandatory = $true)][string]$EventPath,
    [Parameter(Mandatory = $true)][string]$EventCode,
    [string]$RequestId = '',
    [string]$Stage = '',
    [string]$Outcome = '',
    [long]$ActiveLeases = -1,
    [long]$WorkflowRunId = 0
  )

  if ($EventCode -notmatch '^[a-z][a-z0-9_]{2,63}$') {
    throw 'invalid_redacted_event_code'
  }
  if ($RequestId -and $RequestId -notmatch '^[0-9a-f-]{36}$') {
    throw 'invalid_redacted_event_request_id'
  }
  if ($Stage -and $Stage -notmatch '^[a-z][a-z0-9_]{2,63}$') {
    throw 'invalid_redacted_event_stage'
  }
  if ($Outcome -and $Outcome -notmatch '^[a-z][a-z0-9_]{2,63}$') {
    throw 'invalid_redacted_event_outcome'
  }
  if ($ActiveLeases -lt -1 -or $WorkflowRunId -lt 0) {
    throw 'invalid_redacted_event_counter'
  }

  $event = [ordered]@{
    eventCode = $EventCode
    timestamp = [DateTimeOffset]::UtcNow.UtcDateTime.ToString(
      'yyyy-MM-ddTHH:mm:ss.fffZ',
      [Globalization.CultureInfo]::InvariantCulture
    )
  }
  if ($RequestId) { $event.requestId = $RequestId }
  if ($Stage) { $event.stage = $Stage }
  if ($Outcome) { $event.outcome = $Outcome }
  if ($ActiveLeases -ge 0) { $event.activeLeases = $ActiveLeases }
  if ($WorkflowRunId -gt 0) { $event.workflowRunId = $WorkflowRunId }

  $jsonLine = ($event | ConvertTo-Json -Compress) + [Environment]::NewLine
  $stream = $null
  $writer = $null
  try {
    $stream = [IO.File]::Open(
      [IO.Path]::GetFullPath($EventPath),
      [IO.FileMode]::Append,
      [IO.FileAccess]::Write,
      [IO.FileShare]::Read
    )
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    $writer.Write($jsonLine)
    $writer.Flush()
  }
  finally {
    if ($null -ne $writer) { $writer.Dispose() }
    elseif ($null -ne $stream) { $stream.Dispose() }
  }
  Set-SupportAutopilotCurrentUserAcl -Path $EventPath
}
