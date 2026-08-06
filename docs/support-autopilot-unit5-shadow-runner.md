# Support Autopilot Unit 5 Shadow Runner

The runner records internal shadow decisions and cannot deliver them to customers. It can run in the foreground or through the guarded current-user Windows supervisor described below. Installing scheduled tasks is an explicit production operation; building the repository alone does not enable autostart.

## Prerequisites

1. Choose an isolation mode. A dedicated Windows service account is preferred for unattended multi-user hosts. A single-user desktop mode may run under the current Windows account, but it must still use a dedicated `CODEX_HOME`, empty runtime, credential directory, and state directory used only by the support runner.
2. Install the standalone Codex CLI, for example with `npm install -g @openai/codex`.
3. Authenticate that CLI with ChatGPT in a reviewed workspace. API-key login is rejected.
4. Create a dedicated absolute `CODEX_HOME` containing exactly one enabled MCP server named `support-autopilot`.
5. Configure that server as stdio with the reviewed absolute Node executable and built `support-autopilot-mcp-launcher.js`. Configure exactly the two reviewed non-secret MCP environment values `ADMIN_API_BASE_URL` and `SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH`; configure no token, no `env_vars`, and no other servers.
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

Codex does not forward arbitrary parent-process values to stdio MCP servers. Register the same reviewed URL and DPAPI path explicitly in the dedicated profile:

```toml
[mcp_servers.support-autopilot.env]
ADMIN_API_BASE_URL = "https://malikbot.ru/new-admin"
SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH = "C:\\support-autopilot\\credentials\\support-autopilot.dpapi"
```

The production preflight requires these exact two keys and exact configured values. The local doctor requires the exact credential path and a credential-free HTTPS URL. Any token, extra key, `env_vars` entry, URL credential/query/hash, or path mismatch fails closed. The synthetic profile remains environment-free.

Build with `npm run build`. `npm run support-autopilot:shadow` starts the foreground process only when the exact enable value is `true`.

## Current-User Windows Supervisor

Single-user desktop mode uses two scheduled tasks under the current Windows
identity. Both use `InteractiveToken` and `LeastPrivilege`; neither stores a
Windows password.

- `Sdelka Support Autopilot Watchdog` runs at logon and every five minutes. It
  starts exactly one reviewed runner process, refuses to start with an expired
  credential or while a rotation is pending, and replaces an idle stale runner
  only after the server confirms that it has no active lease.
- `Sdelka Support Autopilot Credential Supervisor` runs at logon and every
  fifteen minutes. It
  rotates only the dedicated support-autopilot service credential when fewer
  than six hours remain. It never reads or changes customer authentication,
  provider credentials, money, ticket state, or customer settings.

The start script delegates only process creation to a bounded Node launcher.
That launcher inherits the already-prepared non-secret runtime environment,
binds all three standard streams to current-user-only files, detaches the exact
runner process, returns its PID, and exits. The supervisor does not synchronously
wait on a PowerShell process that owns the long-lived runner. It retains the
rotation lock until the transient PowerShell helper exits, validates its exit
code and returned PID, and terminates that exact helper before releasing the
lock on timeout. It then scans for exact runner PIDs that were absent before
the helper and contains any boundary-race child before the lock is released.
Containment requests a bounded graceful drain, then force-stops the still
matching exact runner process when it ignores that request.
An existing runner is accepted only when the start script reports it fresh;
an idle stale runner is drained and replaced through that same start script.

Build the reviewed checkout and inspect the no-mutation plans first:

```powershell
corepack pnpm verify

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  scripts/start-support-autopilot-shadow-runner.ps1 -PlanOnly

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  scripts/invoke-support-autopilot-credential-supervisor.ps1 -PlanOnly

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  scripts/install-support-autopilot-scheduled-tasks.ps1 -PlanOnly
```

The rotation journal is non-secret and contains only stages, UUIDs, hashes,
timestamps, a candidate path, the expected Git revision, and a workflow run id.
The stages are `runner_stopped`, `candidate_ready`, `dispatch_prepared`,
`workflow_dispatched`, `server_accepted`, and `candidate_promoted`. Every read
is schema-validated. `dispatch_prepared` allows recovery to look for the exact
UUID/SHA run before deciding whether a dispatch still needs to be sent.
The candidate path is bound to the exact request UUID under the credential
directory. The generated token is decrypted only in memory to compare its
SHA-256 digest before atomic promotion.

Install the tasks only after the initial journal contains the active
credential's hash-free issue and expiry timestamps:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  scripts/install-support-autopilot-scheduled-tasks.ps1
```

Export and inspect both task definitions after installation. Their arguments
must contain only the reviewed script path and install root. The definitions
must contain `InteractiveToken`, `LeastPrivilege`, `IgnoreNew`, and
`StartWhenAvailable`, with five-minute and fifteen-minute repetition respectively.

The supervisor requires all queue, privacy, attestation, and runner gates before
starting a normal rotation. It checks `activeLeases` before stopping the runner,
requests a graceful local drain, and checks again after the process exits. The
runner checks the drain request before starting work and finishes an in-flight
decision before exiting. The supervisor defers instead of rotating through
active work. It dispatches only
`support-autopilot-credential-rotation.yml` in
`afed9260/ai-agent-backend` from the immutable
`support-autopilot-credential-rotation-v1` tag, correlates the exact request UUID,
tag, and pinned SHA `ba167befdbded7e6235d192b5d3c81e336f09490`, waits for
success, then atomically replaces the DPAPI blob while retaining one
encrypted rollback blob. An orphan candidate created before its journal update
is deleted and regenerated. A missing candidate after server acceptance causes
a fresh candidate and a second guarded rotation; it is never replaced by a
one-off local send. A confirmed failed workflow is recovered only when
the old credential still passes the dedicated health boundary. Ambiguous state
fails closed and remains in the journal for the next audited recovery attempt.
Queued workflow runs are cancelled after a bounded wait. An in-progress run is
never cancelled by the local timeout; its journal and encrypted candidate stay
intact for deterministic inspection. The old runner is restored only after the
exact run is terminal and the old credential still passes its dedicated health
boundary. If that credential is already expired, a failed workflow also keeps
the journal and candidate instead of discarding the only recovery evidence.
Runner restart readiness is taken only from the authenticated health response:
the backend must report `runnerReady=true`, all support automation gates ready,
and a heartbeat newer than the value captured before a newly started process.
The live redirected stderr file is diagnostic output, not a synchronization
boundary.

If the computer was offline long enough for the dedicated credential to expire,
the watchdog leaves the runner stopped. The supervisor waits thirty minutes
after expiry so every possible 30-minute job lease has ended, then performs the
same guarded rotation without relying on the expired credential. This path does
not alter customer authentication or provider credentials.

To remove only these two tasks without touching credentials or runner state:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  scripts/uninstall-support-autopilot-scheduled-tasks.ps1
```

This mode is not an unattended Windows service. The computer must be powered
on, online, and logged into the same Windows account. A locked session is
acceptable, but a signed-out session cannot run `InteractiveToken` tasks. The
dedicated ChatGPT-authenticated Codex profile and privacy attestation must also
remain valid; their renewal is not handled by the service-credential rotation.

The state directory, state files, event journal, and runner logs use protected
current-user-only ACLs. `credential-rotation.events.jsonl` contains only stable
event codes, timestamps, stages, UUIDs, counters, outcomes, and workflow run
ids. Raw errors, command output, tokens, ticket content, and provider responses
are forbidden. If `SUPPORT_AUTOPILOT_SERVICE_TOKEN` or `ADMIN_API_TOKEN` is
present in the environment, startup and rotation fail closed and record only a
redacted blocker; the variables are never silently removed.

## Local Readiness Doctor

Build and run the foreground doctor before configuring or starting production shadow:

```powershell
corepack pnpm build
corepack pnpm support-autopilot:readiness
```

The doctor reuses the local runner path and attestation variables listed above, plus `SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS`. It does not require the shadow enable flag, worker id, daily budget, budget state, or Admin API URL.

The command checks the standalone Codex CLI, ChatGPT login, exact `support-autopilot` MCP profile, isolated empty runtime, DPAPI credential-blob presence, and privacy attestation. It never decrypts or reads the credential blob, contacts the Admin backend, performs the credential-backed health smoke, starts the runner, polls the queue, or handles customer data.

Output is one redacted JSON object. It contains only `outcome`, six stable `checks`, and sorted stable `blockers`; it never contains paths, command output, file contents, raw errors, tokens, URLs, ticket data, or customer data. Example while the local profile is valid but credential and attestation files are absent:

```json
{"blockers":["credential_blob_unavailable","privacy_attestation_unavailable"],"checks":[{"id":"codex_cli","status":"ready"},{"id":"codex_login","status":"ready"},{"id":"mcp_profile","status":"ready"},{"id":"runtime","status":"ready"},{"id":"credential_blob","status":"blocked"},{"id":"privacy_attestation","status":"blocked"}],"outcome":"blocked"}
```

Exit code `0` means locally ready, `2` means expected blockers remain, and `1` means an unexpected bounded diagnostic failure. A `ready` doctor report is advisory and never replaces the production preflight or authorizes credentials, privacy approval, queue access, or customer delivery. If `SUPPORT_AUTOPILOT_SERVICE_TOKEN` or `ADMIN_API_TOKEN` is present, the doctor reports `plaintext_token_present` and does not invoke Codex.

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
