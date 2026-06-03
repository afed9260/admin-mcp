# admin-mcp Deploy Guide

This service is an MCP server for MalikBot admin data. By default it exposes read-only tools and safe
automation tools only. Guarded write tools are exposed only when `ADMIN_MCP_ENABLE_WRITE=true`.

Current transport: stdio.

Because the current transport is stdio, the MCP process must be started by the agent runtime that will use it. It is not an HTTP web app, and nginx is not needed for this version.

## 1. Clone

```bash
git clone git@github.com:afed9260/admin-mcp.git
cd admin-mcp
```

## 2. Install And Build

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` runs typecheck, tests, and build. After it passes, compiled code is in `dist/`.

## 3. Environment

Set these values in the MCP client config or process environment:

```bash
ADMIN_API_BASE_URL=https://malikbot.ru/new-admin
ADMIN_API_TOKEN=replace-with-read-only-admin-token
AUDIT_LOG_PATH=/var/log/admin-mcp/admin-mcp.jsonl
ADMIN_MCP_ENABLE_WRITE=false
```

Use a read-only backend service token if the backend supports it. If write tools are enabled, the token must have the matching admin permissions. Do not commit or paste the token into prompts.

## 4. Codex MCP Config Example

Add an MCP server entry to the Codex config on the machine that runs Codex.

On Windows, this repository includes `scripts/run-admin-mcp.ps1`. The script maps `ADMIN_MCP_TOKEN` to `ADMIN_API_TOKEN` at runtime, so the admin token can stay in the user environment instead of being written into `config.toml`.

Example for Linux:

```toml
[mcp_servers.admin_mcp]
command = "/usr/bin/node"
args = ["/opt/admin-mcp/dist/index.js"]
startup_timeout_sec = 120

[mcp_servers.admin_mcp.env]
ADMIN_API_BASE_URL = "https://malikbot.ru/new-admin"
ADMIN_API_TOKEN = "replace-with-read-only-admin-token"
AUDIT_LOG_PATH = "/var/log/admin-mcp/admin-mcp.jsonl"
ADMIN_MCP_ENABLE_WRITE = "false"
```

Example for Windows:

```toml
[mcp_servers.admin_mcp]
command = "powershell.exe"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Users\\Arkadiy\\Desktop\\Аркадий\\ИИ-АГЕНТ\\админка\\admin-mcp\\scripts\\run-admin-mcp.ps1"]
startup_timeout_sec = 120

[mcp_servers.admin_mcp.env]
ADMIN_API_BASE_URL = "https://malikbot.ru/new-admin"
AUDIT_LOG_PATH = "C:\\Users\\Arkadiy\\Desktop\\Аркадий\\ИИ-АГЕНТ\\админка\\admin-mcp\\audit\\admin-mcp.jsonl"
ADMIN_MCP_ENABLE_WRITE = "false"
```

Set the token in the user environment and restart Codex:

```powershell
[Environment]::SetEnvironmentVariable("ADMIN_MCP_TOKEN", "replace-with-read-only-admin-token", "User")
```

Restart Codex after changing the MCP config or user environment.

## 5. Smoke Test

After Codex starts with the MCP server, verify that these tools are visible:

- `get_funnel_stats`
- `get_cost_stats`
- `list_dialogs`
- `get_dialog`
- `get_bot_funnel_stats`
- `get_data_truth_audit`
- `list_data_truth_audit_details`
- `list_bot_funnel_customers`
- `list_nudge_rules`
- `get_nudge_rule_candidates`
- `get_nudge_history`
- `list_support_tickets`
- `get_support_ticket`
- `get_support_summary`
- `get_support_waiting_items`
- `get_support_investigation`
- `list_reactivation_campaign_runs`

These safe automation tools should also be visible without enabling guarded writes:

- `investigate_support_ticket`
- `dry_run_reactivation_dialog_credits`

If `ADMIN_MCP_ENABLE_WRITE=true`, these guarded write tools should also be visible:

- `update_nudge_rule`
- `upload_nudge_photo`
- `send_nudge_test`
- `apply_reactivation_dialog_credits`

Run low-risk read checks:

```text
list_nudge_rules
get_funnel_stats with groupBy=chain
get_data_truth_audit
list_data_truth_audit_details with bucket=meeting_without_charge and limit=5
list_bot_funnel_customers with hasPayments=true and limit=5
list_dialogs with limit=5
list_reactivation_campaign_runs with limit=5
dry_run_reactivation_dialog_credits with telegramUserIds=[808059872,200858348]
```

Then inspect the audit log:

```bash
tail -n 20 /var/log/admin-mcp/admin-mcp.jsonl
```

The audit log should contain tool names, sanitized input, endpoint names, and success/failure status. It must not contain bearer tokens. For `upload_nudge_photo`, the audit log must redact `fileDataBase64`.

## 6. Docker Image

Build:

```bash
docker build -t admin-mcp:latest .
```

This image still runs a stdio MCP server. It is useful only when the MCP client starts the container and attaches stdio. It is not useful behind nginx by itself.

If a remote HTTP MCP server is required later, add a new transport explicitly instead of putting this stdio server behind nginx.

## 7. Safety Checks

Before using a new build:

```bash
corepack pnpm verify
rg "ADMIN_MCP_ENABLE_WRITE|confirm|reason|update_nudge_rule|upload_nudge_photo|send_nudge_test|apply_reactivation_dialog_credits" src test
```

Expected: write tools are limited to guarded nudge tools and the guarded reactivation credit apply tool.
There must be no generic HTTP, SQL, shell, broadcast, or delete tool.

Write tools must remain opt-in via `ADMIN_MCP_ENABLE_WRITE=true`.
