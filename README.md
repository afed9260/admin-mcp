# admin-mcp

Read-only MCP server for MalikBot admin data.

## Environment Variables

- `ADMIN_API_BASE_URL`
- `ADMIN_API_TOKEN`
- `AUDIT_LOG_PATH`

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
- `list_bot_funnel_customers`
- `list_nudge_rules`
- `get_nudge_rule_candidates`
- `get_nudge_history`

There are no write tools.

## Safety Checks

```bash
pnpm verify
rg "POST|PUT|PATCH|DELETE|toggle|test-send|broadcast" src test
```
