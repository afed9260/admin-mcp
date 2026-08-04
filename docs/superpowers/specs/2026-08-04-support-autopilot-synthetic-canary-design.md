# Support Autopilot Offline Synthetic Canary Design

## Status

Approved direction: run the real standalone Codex CLI against a local synthetic MCP server that implements the production support-autopilot tool contract using deterministic fake data. The canary must not contact the production backend, decrypt a service credential, claim a production job, or deliver a customer response.

## Objective

Prove that the actual Codex CLI can complete one support shadow workflow through the same seven MCP tools and the same decision observer used by the production runner. The result must give useful evidence beyond unit mocks while remaining safe before the ChatGPT and Codex training controls are verified.

The first scenario is text-only and deterministic. It represents a fictional customer asking how to reconnect a fictional Avito integration. No real customer identity, ticket, attachment, provider token, endpoint, or production credential is permitted.

## Alternatives Considered

### Unit tests only

Existing tests already cover worker, JSONL observer, queue bridge, preflight, and tool registration with mocks. They are fast and remain required, but they do not prove that the installed Codex CLI discovers the MCP server, chooses valid tool arguments, follows the lease flow, or emits the expected JSONL events.

### Real Codex with a local synthetic MCP server (selected)

This exercises the actual Codex executable, MCP protocol, seven-tool schemas, prompt, JSONL observer, and one structured decision. A deterministic in-memory state machine replaces the backend and rejects invalid ordering. This provides the strongest useful evidence without customer data or production access.

### Synthetic ticket in the production queue

This would test more deployment infrastructure, but it still requires the production credential, backend privacy gate, queue flags, and operational rollback. It is deferred until account training controls are verified and the offline canary passes.

## Architecture

### Shared execution engine

Extract the process invocation, restricted Codex arguments, worker prompt, JSONL parsing, and exact-one-decision validation from `CodexShadowWorker` into one reusable execution unit. `CodexShadowWorker` remains the production facade and supplies the production child environment. The synthetic canary supplies a minimal child environment containing only operating-system variables and its isolated `CODEX_HOME`.

The extraction must preserve production behavior. Existing worker tests must continue to pass without changing their assertions.

### Synthetic MCP server

Add a development-only stdio entry point that constructs the normal `McpServer` and calls `registerSupportAutopilotTools`. It uses an in-memory API implementation instead of `SupportAutopilotApiClient`, so the tool names, Zod input schemas, annotations, image handling, and response serialization remain production code rather than copied fixtures.

The in-memory API exposes one fictional job with fixed identifiers and a fixed lease token. Its state machine enforces:

1. availability may be checked before claim;
2. exactly one claim is accepted;
3. context is available only for the active synthetic lease;
4. no attachment exists in the first scenario;
5. a decision is accepted only after context was read and only when ticket version and latest message id match;
6. no second decision or post-completion mutation is accepted.

Invalid paths, identities, lease tokens, ordering, or payload assumptions return tool failures. The real Codex run therefore fails if it does not follow the contract.

### Synthetic canary command

Add a foreground command, `support-autopilot:synthetic-canary`, with a dedicated configuration namespace. It requires absolute paths to the standalone Codex executable, an isolated synthetic `CODEX_HOME`, an empty runtime directory, Node.js, and the compiled synthetic MCP entry point.

The command performs a synthetic preflight before invoking Codex:

- reject `ADMIN_API_BASE_URL`, `ADMIN_API_TOKEN`, `SUPPORT_AUTOPILOT_SERVICE_TOKEN`, and `SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH` if any are present;
- reject paths inside the repository and reject a non-empty runtime directory;
- require `codex login status` to report ChatGPT authentication;
- require exactly one enabled MCP server named `support-autopilot`;
- require that server to execute Node.js with only the compiled synthetic MCP entry point and no configured environment variables;
- run Codex with the existing restricted flags and read-only sandbox;
- accept only a zero exit code, at most two observable rejected MCP calls, and exactly one completed `submit_support_automation_decision` call.

The command prints only a bounded summary containing outcome, duration, tool-call count, failed-call count, and successful-decision count. It never prints prompts, MCP results, lease tokens, context, proposed replies, stdout, or stderr.

### Local isolation

The synthetic profile uses directories outside the repository and separate from the production-shadow profile:

- `synthetic-codex-home` for ChatGPT auth and the one-server MCP allowlist;
- `synthetic-runtime-empty` for the read-only working directory.

The auth file may be copied locally from the already authenticated same-user support profile without reading or printing it. ACLs remain restricted to the current Windows user and `SYSTEM`. The synthetic profile contains no production MCP launcher and no service credential.

## Data Flow

1. The canary validates local paths, the isolated MCP allowlist, and the absence of production environment variables.
2. It starts the real Codex CLI in the empty read-only runtime.
3. Codex starts only the synthetic MCP server.
4. The MCP server returns the fixed fictional job and validates every request through the normal production tool schemas plus the synthetic state machine.
5. Codex submits one fictional shadow decision.
6. The shared JSONL observer validates the completed tool calls and discards raw output.
7. The canary emits a redacted numeric summary and exits.

No network route to the SDELKA backend exists in this flow. OpenAI still processes the fictional prompt and fictional tool content, which is acceptable for this pre-privacy-gate test because it contains no customer or company secret.

## Failure Handling

All failures collapse to stable synthetic error codes at the command boundary. Raw Codex output, MCP payloads, and thrown provider messages are not logged. Any unexpected MCP server, configured MCP environment entry, production variable, non-empty runtime, more than two failed tool calls, missing decision, duplicate decision, malformed JSONL, timeout, or nonzero process exit fails the canary. Zero failed calls is the clean target; one or two recovered calls remain visible in the redacted summary.

The canary has no retry loop, scheduler, queue polling, Windows service, or automatic startup. One invocation can process exactly one in-memory scenario and then exits.

## Testing

Implementation follows red-green-refactor:

- configuration tests prove production variables and unsafe paths are rejected;
- synthetic API state-machine tests prove valid sequencing and fail-closed behavior;
- MCP integration tests prove the server exposes exactly `supportAutopilotToolNames` through the shared registration function;
- execution tests prove the production facade retains its current behavior and the synthetic environment contains no production values;
- command tests prove only the redacted summary is emitted;
- the full existing suite and TypeScript build must remain green;
- one manual acceptance run uses the installed standalone Codex CLI and the fictional scenario.

The manual run is evidence for CLI and MCP interoperability only. It does not authorize production credentials, production queue flags, customer data, customer delivery, Telegram notifications, or a privacy attestation.

## Rollout Boundary

The synthetic command is a developer-operated foreground tool. It is not installed as a service or scheduled task. Production shadow work remains blocked until both relevant OpenAI training controls are verified, the privacy attestation is updated truthfully, a bounded DPAPI credential is issued, and the guarded production preflight passes.
