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
ADMIN_MCP_PROFILE=admin
```

Use a read-only backend service token if the backend supports it. If write tools are enabled, the token must have the matching admin permissions. Do not commit or paste the token into prompts.

### Support Autopilot Queue Profile

Unit 4 exposes only queue availability, claim, lease renewal, and aggregate health. It still cannot read ticket
content, invoke Codex, submit a decision, reply to a customer, or mutate ticket lifecycle state. Do not use the profile
to process production tickets yet.

Required runtime values for the future dedicated runner:

```text
ADMIN_API_BASE_URL=https://malikbot.ru/new-admin
ADMIN_MCP_PROFILE=support_autopilot
ADMIN_MCP_ENABLE_WRITE=false
SUPPORT_AUTOPILOT_SERVICE_TOKEN=<short-lived-dedicated-token>
```

The token must be injected into the child process from OS or MCP credential storage. It must not be Arkadiy's admin
token, `ADMIN_MCP_TOKEN`, `ADMIN_API_TOKEN`, `SUPPORT_AI_INTERNAL_TOKEN`, a provider credential, a command-line
argument, or a value committed to a config file. The backend credential expires within 24 hours and records its
`issuedAt` timestamp. Credential rotation remains a production-runner prerequisite; queue lease renewal does not renew
the service credential.

Both backend flags remain disabled by default:

```text
SUPPORT_AUTOMATION_JOB_CREATION_ENABLED=false
SUPPORT_AUTOMATION_CLAIMS_ENABLED=false
```

This repository adds no executable bridge command or automatic startup. Unit 4 must be validated with tests and
staging-only probes; enabling production processing belongs to a later rollout.

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
ADMIN_MCP_PROFILE = "admin"
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
ADMIN_MCP_PROFILE = "admin"
```

Set the token in the user environment and restart Codex:

```powershell
[Environment]::SetEnvironmentVariable("ADMIN_MCP_TOKEN", "replace-with-read-only-admin-token", "User")
```

Restart Codex after changing the MCP config or user environment.

## 5. Smoke Test

For `ADMIN_MCP_PROFILE=support_autopilot`, the complete expected tool list is:

- `get_support_automation_work_availability`
- `claim_support_automation_job`
- `renew_support_automation_lease`
- `get_support_automation_context`
- `get_support_automation_attachment`
- `submit_support_automation_decision`
- `get_support_automation_health`

No regular admin or readonly tool may be visible in that profile. Health is the only safe smoke check before the
shadow runner privacy and isolation preflight passes. Do not claim a production job manually.

The standalone Unit 5 runner is not part of normal MCP server deployment and has no autostart. Follow
`docs/support-autopilot-unit5-shadow-runner.md` only after the backend privacy gate is approved.

After Codex starts with the MCP server, verify that these tools are visible:

- `get_funnel_stats`
- `get_cost_stats`
- `list_dialogs`
- `get_dialog`
- `get_bot_funnel_stats`
- `get_data_truth_audit`
- `get_identity_mapping_audit`
- `list_data_truth_audit_details`
- `list_bot_funnel_customers`
- `list_nudge_rules`
- `get_nudge_rule_candidates`
- `get_nudge_history`
- `list_support_tickets`
- `get_support_ticket`
- `get_support_summary`
- `get_support_queue_risk`
- `get_support_waiting_items`
- `get_support_investigation`
- `get_customer_operations_profile`
- `get_customer_billing_reconciliation`
- `list_referral_manual_review_items`
- `list_reactivation_campaign_runs`
- `list_reactivation_campaign_audience`
- `get_reactivation_campaign_state`

These safe automation tools should also be visible without enabling guarded writes:

- `investigate_support_ticket`
- `dry_run_customer_dialog_launch_credits`
- `dry_run_successful_dialog_debt_recovery`
- `dry_run_reactivation_dialog_credits`
- `dry_run_reactivation_notification`

If `ADMIN_MCP_ENABLE_WRITE=true`, these guarded write tools should also be visible:

- `update_nudge_rule`
- `toggle_nudge_rule`
- `process_nudge_rule`
- `upload_nudge_photo`
- `send_nudge_test`
- `apply_reactivation_dialog_credits`
- `send_reactivation_notification`
- `execute_support_action_batch`
- `apply_customer_dialog_launch_credits`
- `apply_successful_dialog_debt_recovery`
- `approve_referral_manual_review_grant`
- `reject_referral_manual_review_grant`

Do not run `execute_support_action_batch` against a real customer ticket during smoke testing unless an internal
test ticket and the exact approved action batch are provided. Use unit and registration tests as the default dry-run.

Run low-risk read checks:

```text
list_nudge_rules
get_funnel_stats with groupBy=chain
get_data_truth_audit
get_identity_mapping_audit
list_data_truth_audit_details with bucket=meeting_without_charge and limit=5
list_bot_funnel_customers with hasPayments=true and limit=5
list_dialogs with limit=5
list_reactivation_campaign_runs with limit=5
list_reactivation_campaign_audience with segment=paid_avito_no_dialogs and limit=20
get_reactivation_campaign_state with segment=paid_avito_no_dialogs and limit=20
get_customer_operations_profile with telegramUserId=437078503
get_customer_billing_reconciliation with telegramUserId=437078503 and limit=50
dry_run_customer_dialog_launch_credits with telegramUserId=437078503, expectedTelegramUserId=437078503, idempotencyKey=support-ticket-smoke-dialog-credit, reason=smoke test dry run, slots=10
dry_run_reactivation_dialog_credits with audienceSegment=paid_avito_no_dialogs
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
rg "ADMIN_MCP_ENABLE_WRITE|confirm|reason|update_nudge_rule|upload_nudge_photo|send_nudge_test|list_reactivation_campaign_audience|apply_reactivation_dialog_credits|execute_support_action_batch|customer_operations|customer_dialog" src test
```

Expected: write tools are limited to guarded nudge tools, guarded reactivation tools, guarded support action batch, and guarded customer operations credit apply.
The guarded support action batch tool is allowed only with `confirm=true`, `reason`, and the exact action-plan schema.
There must be no generic HTTP, SQL, shell, broadcast, or delete tool.

Write tools must remain opt-in via `ADMIN_MCP_ENABLE_WRITE=true`.
