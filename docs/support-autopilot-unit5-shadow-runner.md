# Support Autopilot Unit 5 Shadow Runner

The runner is dormant code. It has no autostart, Windows service, scheduled task, or production configuration. It records internal shadow decisions only and cannot deliver them to customers.

## Prerequisites

1. Choose an isolation mode. A dedicated Windows service account is preferred for unattended multi-user hosts. A single-user desktop mode may run under the current Windows account, but it must still use a dedicated `CODEX_HOME`, empty runtime, credential directory, and state directory used only by the support runner.
2. Install the standalone Codex CLI, for example with `npm install -g @openai/codex`.
3. Authenticate that CLI with ChatGPT in a reviewed workspace. API-key login is rejected.
4. Create a dedicated absolute `CODEX_HOME` containing exactly one enabled MCP server named `support-autopilot`.
5. Configure that server as stdio with the reviewed absolute Node executable and built `support-autopilot-mcp-launcher.js`. Configure no MCP environment values and no other servers.
6. Create an empty runtime directory. Never place repositories, ticket exports, or customer files there.
7. Generate the service credential with `scripts/new-support-autopilot-credential.ps1` under the same Windows account that runs the shadow runner. It creates 256 random bits, protects the token with DPAPI CurrentUser, applies a user-only ACL, and prints only the SHA-256 digest and bounded timestamps needed by the server rotation workflow. Use `protect-support-autopilot-token.ps1` only when a separately issued token must be imported through `Read-Host -AsSecureString`.
8. Record and approve the privacy attestation before setting backend or runner gates.

The app-bundled Codex executable under `C:\Program Files\WindowsApps` is rejected. At the time Unit 5 was implemented, the local app-bundled executable also returned `Access is denied`; it is not a valid runner dependency.

Single-user desktop mode accepts a weaker OS boundary: another process running as that Windows user can decrypt the DPAPI credential. The separate `CODEX_HOME`, empty runtime, allowlisted MCP profile, short credential lifetime, and disabled customer delivery remain mandatory. Do not use this mode on a shared or untrusted Windows login.

`CODEX_HOME`, the empty runtime, the privacy attestation, the budget state, and the DPAPI blob must be outside the application repository. The budget state and attestation must also be outside the empty runtime, and all three state/credential files use distinct paths.

Generate a fresh, non-overwriting credential candidate under the same Windows account that runs the shadow runner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/new-support-autopilot-credential.ps1 `
  -OutputPath C:\support-autopilot\credentials\credential-<timestamp>.dpapi
```

The JSON output contains exactly `tokenSha256`, `issuedAt`, and `expiresAt`. Send only those values to the guarded Admin backend rotation workflow. Never send or print the decrypted token. Keep the previous blob until the server rotation and local preflight both succeed.

## Privacy Attestation

The attestation file has exact keys and contains no customer data or secret:

```json
{
  "attestationId": "support-privacy-v1",
  "dataControlsApproved": true,
  "expiresAt": "2026-08-30T00:00:00.000Z",
  "modelTrainingDisabled": true,
  "privacyGateApproved": true,
  "workspaceType": "pro"
}
```

The id and expiry must exactly match runner and AI-backend configuration. A Pro workspace requires `modelTrainingDisabled=true`; do not approve the attestation until the corresponding ChatGPT data control is verified.

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

The Codex invocation auto-approves tools only on the preflight-validated `support-autopilot` MCP server. Failed schema calls remain observable. A run may recover from at most two rejected tool calls, but it must still record exactly one successful decision; three failures, no decision, or duplicate successful decisions fail closed.

## Data And Observability

Raw prompts, ticket text, message text, attachment bytes, tool arguments/results, proposed replies, lease tokens, stdout, and stderr are never written to runner logs. Durable local state contains only the Moscow date and invocation count. Logs contain event codes, timestamps, durations, and counters.

## Offline Synthetic Canary

The offline synthetic canary may run before the production privacy attestation is approved because its MCP server contains only deterministic fictional data. It never loads an Admin API URL, service credential, DPAPI blob, production launcher, customer attachment, budget state, or delivery path. It is a foreground developer command and must not be installed as a service or scheduled task.

Use a second profile that is separate from both the normal Codex profile and the production-shadow profile:

```text
C:\support-autopilot\synthetic-codex-home
C:\support-autopilot\synthetic-runtime-empty
```

The runtime must remain empty. Copy only `auth.json` from the already reviewed ChatGPT-authenticated support profile without displaying or parsing it. Restrict both directories and the copied file to the current Windows identity plus `SYSTEM`. Do not copy `config.toml`, session data, logs, shell snapshots, skills, or MCP configuration.

Build the repository and register exactly one MCP server in the synthetic profile:

```powershell
corepack pnpm build

$env:CODEX_HOME = 'C:\support-autopilot\synthetic-codex-home'
& 'C:\Tools\codex.exe' mcp add support-autopilot -- `
  'C:\Program Files\nodejs\node.exe' `
  'C:\reviewed-repo\dist\synthetic\synthetic-support-autopilot-mcp.js'

& 'C:\Tools\codex.exe' login status
& 'C:\Tools\codex.exe' mcp list --json
```

The login must be exactly `Logged in using ChatGPT`. The MCP list must contain one enabled stdio server named `support-autopilot`, with the reviewed Node executable as its command, the compiled synthetic entry point as its sole argument, and no `cwd`, `env`, or `env_vars` configuration.

Run the canary from a shell where all four production variables are absent:

```powershell
Remove-Item Env:ADMIN_API_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ADMIN_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH -ErrorAction SilentlyContinue

$env:SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_ENABLED = 'true'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_EXECUTABLE = 'C:\Tools\codex.exe'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME = 'C:\support-autopilot\synthetic-codex-home'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_MCP_ENTRY_PATH = 'C:\reviewed-repo\dist\synthetic\synthetic-support-autopilot-mcp.js'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_NODE_EXECUTABLE = 'C:\Program Files\nodejs\node.exe'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS = '600000'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR = 'C:\support-autopilot\synthetic-runtime-empty'
$env:SUPPORT_AUTOPILOT_SYNTHETIC_WORKER_ID = 'support-synthetic.1'

corepack pnpm support-autopilot:synthetic-canary
```

Success prints one bounded JSON object containing only `outcome`, `durationMs`, `toolCalls`, `failedToolCalls`, and `successfulDecisionSubmissions`. `outcome` must be `passed`, successful decision submissions must be exactly one, and `failedToolCalls` must be between zero and two. Zero is a clean run; one or two means Codex corrected a rejected schema call and the count must remain visible for quality review. The command never prints the fictional context, prompt, lease, reply, stdout, stderr, token, or a backend URL. Any invalid profile, unexpected production variable, process failure, malformed output, more than two failed tool calls, or missing/duplicate decision fails closed.

After a temporary test, stop any foreground process, remove the synthetic MCP registration, and delete only the reviewed synthetic profile and empty runtime paths. Never remove or edit the production-shadow `CODEX_HOME`, credential directory, privacy attestation, or budget state as part of synthetic cleanup.

## Canary And Rollback

Start only with reviewed internal canary jobs after all three services are deployed. Review every shadow decision and attachment use. Do not enable customer delivery in Unit 5.

Rollback order:

1. Set `SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED=false` and stop the foreground process.
2. Disable backend shadow mode and claims.
3. Preserve redacted counters, heartbeat, and shadow decisions for review.
4. Remove the dedicated MCP config and DPAPI blob only after the process is stopped.

No customer/provider token rotation is part of startup or rollback.
