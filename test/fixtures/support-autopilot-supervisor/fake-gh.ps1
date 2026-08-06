$ErrorActionPreference = 'Stop'
$expectedSha = 'ba167befdbded7e6235d192b5d3c81e336f09490'
$expectedRef = 'support-autopilot-credential-rotation-v1'
$statePath = $env:SUPPORT_AUTOPILOT_FAKE_GH_STATE_PATH

if ($args[0] -eq 'api' -and $args[1] -like '*/git/ref/tags/*') {
  $expectedSha
  exit 0
}
if ($args[0] -eq 'api' -and $args[1] -like '*/actions/runners') {
  '{"runners":[{"name":"prod-server-runner","status":"online","busy":false}]}'
  exit 0
}
if ($args[0] -eq 'run' -and $args[1] -eq 'list') {
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    Get-Content -LiteralPath $statePath -Raw -Encoding UTF8
  }
  else {
    '[]'
  }
  exit 0
}
if ($args[0] -eq 'workflow' -and $args[1] -eq 'run') {
  $requestId = $null
  for ($index = 0; $index -lt $args.Count; $index += 1) {
    if ($args[$index] -eq '-f' -and $index + 1 -lt $args.Count) {
      $field = [string]$args[$index + 1]
      if ($field.StartsWith('request_id=')) {
        $requestId = $field.Substring('request_id='.Length)
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($requestId)) {
    throw 'request id missing'
  }
  $inventory = @([ordered]@{
    conclusion = 'success'
    databaseId = 424242
    displayTitle = "Support Autopilot Credential Rotation action=enable request_id=$requestId"
    event = 'workflow_dispatch'
    headBranch = $expectedRef
    headSha = $expectedSha
    status = 'completed'
  })
  [IO.File]::WriteAllText(
    $statePath,
    (ConvertTo-Json -InputObject $inventory -Depth 4 -Compress),
    [Text.UTF8Encoding]::new($false)
  )
  exit 0
}
if ($args[0] -eq 'run' -and $args[1] -eq 'cancel') {
  exit 0
}

throw 'unsupported fake gh invocation'
