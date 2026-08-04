# admin-mcp

MCP server for MalikBot admin data.

By default it exposes read-only tools and safe automation tools only. Guarded write tools are available only when
`ADMIN_MCP_ENABLE_WRITE=true`.

`ADMIN_MCP_PROFILE` selects one explicit surface:

- `admin` (default) - existing read, safe automation, and optional guarded write tools;
- `readonly` - existing read-only tools only;
- `support_autopilot` - dedicated automation identity and support-only contracts.

The `support_autopilot` profile exposes only seven lease-scoped shadow tools. It does not expose customer profiles,
provider identifiers, general admin reads, diagnostics, or customer-facing actions.

## Environment Variables

- `ADMIN_API_BASE_URL`
- `ADMIN_API_TOKEN`
- `AUDIT_LOG_PATH`
- `ADMIN_MCP_ENABLE_WRITE` - optional, set to `true` to expose guarded write tools
- `ADMIN_MCP_PROFILE` - optional; `admin`, `readonly`, or `support_autopilot`
- `SUPPORT_AUTOPILOT_SERVICE_TOKEN` - required only for `support_autopilot`; never falls back to an admin token

`ADMIN_MCP_ENABLE_WRITE=true` is rejected for `readonly` and `support_autopilot`. The support token must be a separate,
short-lived credential injected from OS or MCP credential storage at process start. Do not store it in this repository,
Codex configuration, prompts, or a persistent general user environment.

## Local Commands

```bash
pnpm install
pnpm verify
pnpm dev
```

Deployment and MCP client setup are documented in [DEPLOY.md](./DEPLOY.md).

## Exposed Tools

The restricted `support_autopilot` profile exposes exactly:

- `get_support_automation_work_availability`
- `claim_support_automation_job`
- `renew_support_automation_lease`
- `get_support_automation_context`
- `get_support_automation_attachment`
- `submit_support_automation_decision`
- `get_support_automation_health`

Claim and renewal use one-time lease tokens. These tools intentionally bypass the general admin audit wrapper so raw
lease tokens are not persisted. The backend stores only their SHA-256 hashes.

Context and image access require the current lease. Decision submission records a shadow result only: it cannot send
customer text, change ticket lifecycle, or execute an action. The standalone runner remains disabled unless its exact
enable flag, privacy attestation, isolated CLI runtime, credential boundary, and preflight all pass.

The regular `admin` and `readonly` profiles retain their existing tools:

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

Safe automation tools, available without `ADMIN_MCP_ENABLE_WRITE=true`:

- `investigate_support_ticket`
- `dry_run_customer_dialog_launch_credits`
- `dry_run_successful_dialog_debt_recovery`
- `dry_run_reactivation_dialog_credits`
- `dry_run_reactivation_notification`

Optional write tools, only with `ADMIN_MCP_ENABLE_WRITE=true`:

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

Every write tool requires `confirm: true` and a short `reason`. Write calls are audit-logged.
Support action batches also require the exact pre-approved action plan, freshness fields, and idempotency key.
For the reactivation campaign, prefer `audienceSegment` (`paid_avito_no_dialogs`,
`paid_no_avito_no_dialogs`, or `paid_no_dialogs_all`) over manual Telegram user id lists.

## Safety Checks

```bash
pnpm verify
rg "ADMIN_MCP_ENABLE_WRITE|confirm|reason|update_nudge_rule|upload_nudge_photo|send_nudge_test|list_reactivation_campaign_audience|apply_reactivation_dialog_credits|execute_support_action_batch|customer_operations|customer_dialog" src test
```
