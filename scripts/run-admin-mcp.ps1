$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$entrypoint = Join-Path $repoRoot "dist\index.js"

if (-not (Test-Path -LiteralPath $entrypoint)) {
    Write-Error "Compiled MCP entrypoint not found: $entrypoint. Run corepack pnpm build first."
    exit 1
}

if (-not $env:ADMIN_API_TOKEN) {
    if ($env:ADMIN_MCP_TOKEN) {
        $env:ADMIN_API_TOKEN = $env:ADMIN_MCP_TOKEN
    }
}

if (-not $env:ADMIN_API_TOKEN) {
    [Console]::Error.WriteLine("ADMIN_MCP_TOKEN or ADMIN_API_TOKEN is required for admin-mcp.")
    exit 1
}

& node $entrypoint
exit $LASTEXITCODE
