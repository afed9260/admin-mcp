# admin-mcp Deploy Guide

This service is a read-only MCP server for MalikBot admin data.

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
```

Use a read-only backend service token if the backend supports it. Do not commit or paste the token into prompts.

## 4. Codex MCP Config Example

Add an MCP server entry to the Codex config on the machine that runs Codex.

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
```

Example for Windows:

```toml
[mcp_servers.admin_mcp]
command = "node"
args = ["C:\\Users\\Arkadiy\\Desktop\\Аркадий\\ИИ-АГЕНТ\\админка\\admin-mcp\\dist\\index.js"]
startup_timeout_sec = 120

[mcp_servers.admin_mcp.env]
ADMIN_API_BASE_URL = "https://malikbot.ru/new-admin"
ADMIN_API_TOKEN = "replace-with-read-only-admin-token"
AUDIT_LOG_PATH = "C:\\Users\\Arkadiy\\Desktop\\Аркадий\\ИИ-АГЕНТ\\админка\\admin-mcp\\audit\\admin-mcp.jsonl"
```

Restart Codex after changing the MCP config.

## 5. Smoke Test

After Codex starts with the MCP server, verify that these tools are visible:

- `get_funnel_stats`
- `get_cost_stats`
- `list_dialogs`
- `get_dialog`
- `get_bot_funnel_stats`
- `list_nudge_rules`
- `get_nudge_rule_candidates`
- `get_nudge_history`

Run low-risk read checks:

```text
list_nudge_rules
get_funnel_stats with groupBy=chain
list_dialogs with limit=5
```

Then inspect the audit log:

```bash
tail -n 20 /var/log/admin-mcp/admin-mcp.jsonl
```

The audit log should contain tool names, sanitized input, endpoint names, and success/failure status. It must not contain bearer tokens.

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
rg "POST|PUT|PATCH|DELETE|toggle|test-send|broadcast" src test
```

Expected: the grep should only hit the negative read-only guard test, not source endpoints.

Phase 10 intentionally exposes no write tools.
