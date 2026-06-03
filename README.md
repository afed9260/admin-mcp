# admin-mcp

MCP server for MalikBot admin data.

By default it exposes read-only tools and safe automation tools only. Guarded write tools are available only when
`ADMIN_MCP_ENABLE_WRITE=true`.

## Environment Variables

- `ADMIN_API_BASE_URL`
- `ADMIN_API_TOKEN`
- `AUDIT_LOG_PATH`
- `ADMIN_MCP_ENABLE_WRITE` - optional, set to `true` to expose guarded write tools

## Local Commands

```bash
pnpm install
pnpm verify
pnpm dev
```

Deployment and MCP client setup are documented in [DEPLOY.md](./DEPLOY.md).

## Exposed Tools

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

Safe automation tools, available without `ADMIN_MCP_ENABLE_WRITE=true`:

- `investigate_support_ticket`
- `dry_run_reactivation_dialog_credits`

Optional write tools, only with `ADMIN_MCP_ENABLE_WRITE=true`:

- `update_nudge_rule`
- `upload_nudge_photo`
- `send_nudge_test`
- `apply_reactivation_dialog_credits`
- `execute_support_action_batch`

Every write tool requires `confirm: true` and a short `reason`. Write calls are audit-logged.
Support action batches also require the exact pre-approved action plan, freshness fields, and idempotency key.

## Safety Checks

```bash
pnpm verify
rg "ADMIN_MCP_ENABLE_WRITE|confirm|reason|update_nudge_rule|upload_nudge_photo|send_nudge_test|apply_reactivation_dialog_credits|execute_support_action_batch" src test
```
