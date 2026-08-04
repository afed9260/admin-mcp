# Support Autopilot Unit 5 Shadow Runner

The runner is dormant code. It has no autostart, Windows service, scheduled task, or production configuration. It records internal shadow decisions only and cannot deliver them to customers.

## Prerequisites

1. Use a dedicated Windows service account.
2. Install the standalone Codex CLI, for example with `npm install -g @openai/codex`.
3. Authenticate that CLI with ChatGPT in a reviewed workspace. API-key login is rejected.
4. Create a dedicated absolute `CODEX_HOME` containing exactly one enabled MCP server named `support-autopilot`.
5. Configure that server as stdio with the reviewed absolute Node executable and built `support-autopilot-mcp-launcher.js`. Configure no MCP environment values and no other servers.
6. Create an empty runtime directory. Never place repositories, ticket exports, or customer files there.
7. Provision the service credential with `scripts/protect-support-autopilot-token.ps1`. The script prompts with `Read-Host -AsSecureString`, uses DPAPI CurrentUser protection, and applies a user-only ACL.
8. Record and approve the privacy attestation before setting backend or runner gates.

The app-bundled Codex executable under `C:\Program Files\WindowsApps` is rejected. At the time Unit 5 was implemented, the local app-bundled executable also returned `Access is denied`; it is not a valid runner dependency.

`CODEX_HOME`, the empty runtime, the privacy attestation, the budget state, and the DPAPI blob must be outside the application repository. The budget state and attestation must also be outside the empty runtime, and all three state/credential files use distinct paths.

## Privacy Attestation

The attestation file has exact keys and contains no customer data or secret:

```json
{
  "attestationId": "support-privacy-v1",
  "dataControlsApproved": true,
  "expiresAt": "2026-08-30T00:00:00.000Z",
  "modelTrainingDisabled": false,
  "privacyGateApproved": true,
  "workspaceType": "business"
}
```

The id and expiry must exactly match runner and AI-backend configuration. Plus/Pro workspaces require `modelTrainingDisabled=true`.

## Runner Environment

The runner rejects `SUPPORT_AUTOPILOT_SERVICE_TOKEN` in its environment. Required non-secret configuration is:

```text
SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED=true
SUPPORT_AUTOPILOT_CODEX_EXECUTABLE=<absolute-standalone-codex.exe>
SUPPORT_AUTOPILOT_NODE_EXECUTABLE=<absolute-node.exe>
SUPPORT_AUTOPILOT_CODEX_HOME=<absolute-dedicated-directory>
SUPPORT_AUTOPILOT_RUNTIME_DIR=<absolute-empty-directory>
SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH=<absolute-dpapi-file-outside-repos/runtime>
SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH=<absolute-json-file>
SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID=<reviewed-id>
SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT=<canonical-future-ISO-time>
SUPPORT_AUTOPILOT_WORKER_ID=<bounded-worker-id>
SUPPORT_AUTOPILOT_DAILY_BUDGET=<1..100>
SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS=<30000..1799999>
SUPPORT_AUTOPILOT_BUDGET_STATE_PATH=<absolute-json-state>
SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH=<absolute-built-launcher.js>
ADMIN_API_BASE_URL=<credential-free-https-url>
```

Build with `npm run build`. `npm run support-autopilot:shadow` starts the foreground process only when the exact enable value is `true`.

## Preflight

Before polling, the runner verifies:

- standalone CLI path and required files/directories;
- empty runtime;
- matching, unexpired privacy attestation;
- successful `codex --version`;
- exact `Logged in using ChatGPT` login status;
- exactly one allowlisted MCP server with no configured secret environment;
- a read-only ephemeral Codex smoke that calls only `get_support_automation_health`.

Any failure exits before queue polling. The worker disables shell, web search, code mode, apps, plugins, and multi-agent features; uses read-only sandboxing; processes at most one job; and requires exactly one successful decision submission.

## Data And Observability

Raw prompts, ticket text, message text, attachment bytes, tool arguments/results, proposed replies, lease tokens, stdout, and stderr are never written to runner logs. Durable local state contains only the Moscow date and invocation count. Logs contain event codes, timestamps, durations, and counters.

## Canary And Rollback

Start only with reviewed internal canary jobs after all three services are deployed. Review every shadow decision and attachment use. Do not enable customer delivery in Unit 5.

Rollback order:

1. Set `SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED=false` and stop the foreground process.
2. Disable backend shadow mode and claims.
3. Preserve redacted counters, heartbeat, and shadow decisions for review.
4. Remove the dedicated MCP config and DPAPI blob only after the process is stopped.

No customer/provider token rotation is part of startup or rollback.
