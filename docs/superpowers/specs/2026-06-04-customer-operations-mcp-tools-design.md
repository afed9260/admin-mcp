# Customer Operations MCP Tools Design

## Business Goal

Expose the Customer Operations backend contract through admin-mcp so Codex can inspect a customer profile and perform a guarded dialog-launch credit grant from chat.

The business outcome is operational parity between the admin customer card and the owner chat workflow: an agent can inspect customer facts, dry-run a proposed credit grant, and apply it only with explicit confirmation, reason, target identity, and idempotency.

## Scope

This slice adds three MCP tools:

- `get_customer_operations_profile`
- `dry_run_customer_dialog_launch_credits`
- `apply_customer_dialog_launch_credits`

The tools call existing backend endpoints:

- `GET /customer-operations/profile`
- `POST /customer-operations/dialog-launch-credits/dry-run`
- `POST /customer-operations/dialog-launch-credits/apply`

The slice does not add backend behavior, UI controls, bulk grants, notifications, or direct database access.

## Tool Classification

- `get_customer_operations_profile` is readonly and always registered.
- `dry_run_customer_dialog_launch_credits` is a safe automation tool and is always registered.
- `apply_customer_dialog_launch_credits` is a guarded write tool and is registered only when `ADMIN_MCP_ENABLE_WRITE=true`.

This mirrors the existing support action and reactivation campaign policy.

## Input Contract

Profile lookup accepts:

- `telegramUserId`
- `workspaceId`
- `sdelkaUserId`
- optional `originType`
- optional `originId`

Credit grant accepts the same lookup fields plus:

- `expectedTelegramUserId`
- `expectedWorkspaceId`
- `expectedSdelkaUserId`
- `slots`, default `10`, maximum `10`
- `idempotencyKey`
- `reason`

Apply additionally requires:

- `confirm: true`

The MCP layer validates inputs with Zod. Empty strings are normalized to `undefined`; unknown keys are rejected.

## Safety Rules

The MCP layer is not the final authority for customer safety. It validates shape and intent, then lets the backend enforce identity guardrails, safety flags, idempotency, and billing ledger writes.

The MCP apply tool must pass `confirm` and `reason` through the audit log but must not forward `confirm` to the backend body, following the existing write-tool pattern. The backend receives the actionable request and performs its own guarded apply.

## Audit

Every tool call uses the existing `runWithAudit` path. Audit entries must include the tool name, input, backend endpoint, success or failure, and item count metadata when the backend returns `items`.

No token, secret, raw image, or private file bytes are added to MCP output.

## Verification

Tests must prove:

- readonly list includes `get_customer_operations_profile`;
- safe automation list includes `dry_run_customer_dialog_launch_credits`;
- write list includes `apply_customer_dialog_launch_credits`;
- tool registration order is stable;
- profile calls the expected backend GET with query params;
- dry-run calls the expected backend POST;
- apply is hidden unless write tools are enabled;
- apply requires `confirm=true`;
- apply forwards the backend body without `confirm`;
- unknown arguments are rejected before backend calls.
