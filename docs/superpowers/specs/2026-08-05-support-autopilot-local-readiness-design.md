# Support Autopilot Local Readiness Design

## Goal

Add a foreground, read-only command that explains whether the local production-shadow Codex profile is prepared for the existing guarded preflight. The command must identify local blockers without decrypting a credential, contacting the Admin backend, starting the shadow runner, claiming a ticket, or handling customer data.

## Chosen Approach

Add `support-autopilot:readiness` as a separate diagnostic entry point. It consumes only the existing non-secret local runner path settings plus the expected privacy-attestation identity and expiry. It checks the standalone Codex CLI, ChatGPT login, exact one-server MCP profile, empty runtime, presence of the DPAPI blob, and validity of the privacy attestation.

The command emits one bounded JSON report containing an overall `ready` or `blocked` outcome, six stable check results, and stable blocker codes. It never includes paths, command output, file contents, raw errors, tokens, URLs, ticket data, or customer data. A blocked report exits with code 2; an unexpected internal failure exits with code 1 and prints only `SUPPORT_AUTOPILOT_READINESS_FAILED`.

## Architecture

The doctor is advisory. `CodexShadowPreflight` remains the only production launch authority and continues to perform the credential-backed health smoke before queue polling.

Pure validation rules for Codex version, ChatGPT login, the exact MCP allowlist, and privacy-attestation contents are shared between the doctor and existing preflights. Filesystem and process orchestration stay separate so diagnostics cannot accidentally inherit the production smoke, backend environment, or credential provider.

The doctor uses the existing `CodexProcessRunner` with a minimal child environment containing `CODEX_HOME` and standard Windows process variables only. It invokes exactly:

1. `codex --version`
2. `codex login status`
3. `codex mcp list --json`

It uses `stat` for the DPAPI blob and never reads the blob. The privacy-attestation JSON is non-secret and may be read only to apply the same validation rules as production preflight.

## Configuration

The command reuses these runner environment names so there is no second production configuration model:

- `SUPPORT_AUTOPILOT_CODEX_EXECUTABLE`
- `SUPPORT_AUTOPILOT_NODE_EXECUTABLE`
- `SUPPORT_AUTOPILOT_CODEX_HOME`
- `SUPPORT_AUTOPILOT_RUNTIME_DIR`
- `SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH`
- `SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH`
- `SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID`
- `SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT`
- `SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH`
- `SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS`

Missing or invalid values become blocker codes rather than configuration exceptions. Plaintext token variables are never accepted and produce `plaintext_token_present` before any process execution.

## Checks And Failure Behavior

The stable check ids are `codex_cli`, `codex_login`, `mcp_profile`, `runtime`, `credential_blob`, and `privacy_attestation`. Independent checks continue after a blocker when safe, giving operations one complete local report instead of a fail-fast loop.

Process calls are skipped when their required executable, profile, or runtime inputs are invalid. No raw exception text is serialized. The report is deterministic and bounded.

## Testing

Unit tests cover a fully ready profile, missing configuration, a non-empty runtime, API-key login, extra or misconfigured MCP servers, missing DPAPI blob, invalid or expired attestation, plaintext-token rejection, minimal child environment, bounded output, and the no-process short circuit. Existing production and synthetic preflight tests must continue to pass after sharing pure validators.

A local smoke run against the current production-shadow profile must finish blocked only on the genuinely absent credential and privacy attestation, with no backend request and no runner process.

## Non-Goals

- Creating, decrypting, rotating, or registering credentials.
- Creating or approving a privacy attestation.
- Verifying ChatGPT data-control settings in a browser.
- Calling the Admin backend or testing queue flags.
- Starting or scheduling the shadow runner.
- Enabling customer delivery.
