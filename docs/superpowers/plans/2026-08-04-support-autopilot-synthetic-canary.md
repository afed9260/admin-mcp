# Support Autopilot Offline Synthetic Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a foreground offline canary that runs the real standalone Codex CLI through the production seven-tool support-autopilot MCP contract using only deterministic fictional data.

**Architecture:** Extract one shared Codex decision execution unit and keep `CodexShadowWorker` as the production facade. A development-only stdio MCP server reuses `registerSupportAutopilotTools` with an in-memory state machine, while a separate synthetic config and preflight reject every production credential or endpoint before invoking Codex.

**Tech Stack:** TypeScript, Node.js 22, `@modelcontextprotocol/sdk`, Zod, Vitest, standalone Codex CLI, Windows PowerShell for local acceptance setup.

---

## File Structure

- Create `src/runner/codex-support-decision-execution.ts`: shared prompt, restricted Codex invocation, JSONL validation, and result type.
- Modify `src/runner/codex-shadow-worker.ts`: delegate execution to the shared unit while preserving production events and errors.
- Modify `src/tools/support-autopilot-tools.ts`: accept a narrow structural client interface so production and synthetic clients use the same tool registration.
- Create `src/synthetic/synthetic-support-autopilot-api.ts`: deterministic fictional job and fail-closed in-memory lifecycle.
- Create `src/synthetic/synthetic-support-autopilot-mcp.ts`: development-only stdio MCP entry point using the normal seven-tool registration.
- Create `src/synthetic/support-autopilot-synthetic-canary.config.ts`: isolated path validation and production-variable rejection.
- Create `src/synthetic/codex-synthetic-preflight.ts`: standalone CLI login and exact synthetic MCP allowlist validation.
- Create `src/synthetic/support-autopilot-synthetic-canary-main.ts`: one foreground preflight and one Codex decision execution.
- Modify `package.json`: add the synthetic canary script.
- Modify `docs/support-autopilot-unit5-shadow-runner.md`: document synthetic setup, safety boundary, and acceptance command.
- Create focused tests beside the existing runner tests under `test/`.

### Task 1: Extract the Shared Codex Decision Execution Unit

**Files:**
- Create: `src/runner/codex-support-decision-execution.ts`
- Modify: `src/runner/codex-shadow-worker.ts`
- Create: `test/codex-support-decision-execution.test.ts`
- Test: `test/codex-shadow-worker.test.ts`

- [ ] **Step 1: Write the failing shared-execution test**

Create a test that imports `runCodexSupportDecision`, feeds a fake `CodexProcessRunner` two completed tool events, and asserts the exact restricted invocation and summary:

```ts
const result = await runCodexSupportDecision({
  childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
  codexExecutablePath: "C:\\Tools\\codex.exe",
  processTimeoutMs: 120_000,
  runtimeDir: "C:\\Synthetic\\runtime",
  workerId: "support-synthetic.1",
}, runner(`${toolEvent("claim_support_automation_job")}\n${toolEvent("submit_support_automation_decision")}\n`));

expect(result).toEqual({
  failedToolCalls: 0,
  successfulDecisionSubmissions: 1,
  toolCalls: 2,
});
expect(input.args).toContain("read-only");
expect(input.environment).toEqual({ CODEX_HOME: "C:\\Synthetic\\codex-home" });
expect(input.stdin).toContain("support-synthetic.1");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm vitest run test/codex-support-decision-execution.test.ts`

Expected: FAIL because `codex-support-decision-execution.ts` does not exist.

- [ ] **Step 3: Implement the minimal shared execution unit**

Create the shared input type, exported prompt builder, and function. Use `CODEX_RESTRICTED_EXEC_ARGS`, `CodexJsonlObserver`, a 16 MiB output bound, and the exact-one-successful-decision rule:

```ts
export interface CodexSupportDecisionExecutionConfig {
  childEnvironment: NodeJS.ProcessEnv;
  codexExecutablePath: string;
  processTimeoutMs: number;
  runtimeDir: string;
  workerId: string;
}

export async function runCodexSupportDecision(
  config: CodexSupportDecisionExecutionConfig,
  processRunner: CodexProcessRunner,
): Promise<CodexJsonlSummary> {
  const result = await processRunner.run({
    args: [...CODEX_RESTRICTED_EXEC_ARGS, "--cd", config.runtimeDir, "-"],
    cwd: config.runtimeDir,
    environment: config.childEnvironment,
    executablePath: config.codexExecutablePath,
    maxOutputBytes: 16 * 1024 * 1024,
    stdin: buildSupportAutopilotWorkerPrompt(config.workerId),
    timeoutMs: config.processTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) throw new Error("invalid process");
  const observer = new CodexJsonlObserver({
    maxBytes: 16 * 1024 * 1024,
    maxLineBytes: 12 * 1024 * 1024,
    maxLines: 1_000,
  });
  observer.push(Buffer.from(result.stdout, "utf8"));
  const summary = observer.finish();
  if (summary.failedToolCalls !== 0 || summary.successfulDecisionSubmissions !== 1) {
    throw new Error("invalid decision count");
  }
  return summary;
}
```

Move the current six-sentence prompt into `buildSupportAutopilotWorkerPrompt(workerId)` without changing its text.

- [ ] **Step 4: Delegate production worker execution to the shared unit**

Replace the process and observer block in `CodexShadowWorker.runOne()` with:

```ts
const summary = await runCodexSupportDecision({
  childEnvironment: createCodexChildEnvironment(this.config),
  codexExecutablePath: this.config.codexExecutablePath,
  processTimeoutMs: this.config.processTimeoutMs,
  runtimeDir: this.config.runtimeDir,
  workerId: this.config.workerId,
}, this.processRunner);
```

Keep the existing production event codes, duration measurement, returned fields, catch boundary, and `SUPPORT_AUTOPILOT_CODEX_RUN_FAILED` error unchanged.

- [ ] **Step 5: Run focused and production worker tests**

Run: `corepack pnpm vitest run test/codex-support-decision-execution.test.ts test/codex-shadow-worker.test.ts`

Expected: both files PASS and existing worker assertions remain unchanged.

- [ ] **Step 6: Commit the execution extraction**

```powershell
git add src/runner/codex-support-decision-execution.ts src/runner/codex-shadow-worker.ts test/codex-support-decision-execution.test.ts
git commit -m "refactor(runner): share Codex decision execution"
```

### Task 2: Add the Deterministic Synthetic Backend State Machine

**Files:**
- Modify: `src/tools/support-autopilot-tools.ts`
- Create: `src/synthetic/synthetic-support-autopilot-api.ts`
- Create: `test/synthetic-support-autopilot-api.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover one valid lifecycle and separate fail-closed cases:

```ts
const api = new SyntheticSupportAutopilotApi();
await expect(api.post("/support-automation/jobs/claim", {
  workerId: "support-synthetic.1",
})).resolves.toMatchObject({ jobId: SYNTHETIC_JOB_ID });
await expect(api.post(`/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`, {
  leaseToken: SYNTHETIC_LEASE_TOKEN,
  workerId: "support-synthetic.1",
})).resolves.toMatchObject({ mode: "shadow", attachmentRefs: [] });
await expect(api.post(`/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`, {
  decisionType: "request_information",
  evidenceFactKeys: ["ticket.state", "ticket.latest_message"],
  expectedLatestMessageId: SYNTHETIC_LATEST_MESSAGE_ID,
  expectedTicketVersion: 1,
  internalReasoning: "Synthetic evidence is sufficient.",
  leaseToken: SYNTHETIC_LEASE_TOKEN,
  proposedReply: "Please reconnect the fictional integration.",
  selectedPolicyId: "avito_reconnect_required.v1",
  workerId: "support-synthetic.1",
})).resolves.toMatchObject({ outcome: "shadow_recorded" });
```

Also assert rejection of context-before-claim, wrong worker, wrong lease, decision-before-context, stale version/message id, attachment access, unknown path, and duplicate decision.

Add a separate valid renewal test: after claim, `renew_support_automation_lease` rotates the fixed synthetic lease from `SYNTHETIC_LEASE_TOKEN` to `SYNTHETIC_RENEWED_LEASE_TOKEN`; the old token is then rejected and the renewed token can read context and submit the decision. Assert the health endpoint returns only synthetic lifecycle counters.

- [ ] **Step 2: Run the state-machine test and verify RED**

Run: `corepack pnpm vitest run test/synthetic-support-autopilot-api.test.ts`

Expected: FAIL because the synthetic API module does not exist.

- [ ] **Step 3: Introduce the narrow shared client interface**

In `support-autopilot-tools.ts`, replace the concrete registration argument with:

```ts
export interface SupportAutopilotClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function registerSupportAutopilotTools(
  server: McpServer,
  client: SupportAutopilotClient,
): void {
```

Remove the now-unused concrete client import. The production `SupportAutopilotApiClient` remains the caller and requires no behavior change.

- [ ] **Step 4: Implement the synthetic state machine**

Create fixed UUID constants, two 43-character synthetic lease values, and a private state union of `available | claimed | context_read | decided`. Return a fictional Russian latest message asking how to reconnect a fictional Avito integration, the two permitted evidence facts, no attachment refs, and the `avito_reconnect_required.v1` policy candidate. Implement lease renewal for the active pre-decision job and rotate the token exactly once; expose health as deterministic counters derived from the in-memory state.

Every handler must validate the exact path, current state, worker id, lease token, latest message id, and ticket version before returning. Use a private helper that casts the deterministic object to generic `T`; never add `fetch`, `AdminApiClient`, URLs, tokens, or filesystem access.

- [ ] **Step 5: Run the focused tests**

Run: `corepack pnpm vitest run test/synthetic-support-autopilot-api.test.ts test/support-autopilot-tools.test.ts`

Expected: PASS, including the existing seven-tool schema tests.

- [ ] **Step 6: Commit the state machine**

```powershell
git add src/tools/support-autopilot-tools.ts src/synthetic/synthetic-support-autopilot-api.ts test/synthetic-support-autopilot-api.test.ts
git commit -m "feat(support): add synthetic job state machine"
```

### Task 3: Add the Synthetic Stdio MCP Entry Point

**Files:**
- Create: `src/synthetic/synthetic-support-autopilot-mcp.ts`
- Create: `test/synthetic-support-autopilot-mcp.test.ts`

- [ ] **Step 1: Write the failing MCP contract test**

Connect the returned server with `InMemoryTransport`, list tools, and assert exact equality with `supportAutopilotToolNames`. Call claim, context, and decision through the MCP client to prove the normal Zod schemas and synthetic state machine are both active.

```ts
expect((await client.listTools()).tools.map((tool) => tool.name))
  .toEqual(supportAutopilotToolNames);
```

- [ ] **Step 2: Run the MCP test and verify RED**

Run: `corepack pnpm vitest run test/synthetic-support-autopilot-mcp.test.ts`

Expected: FAIL because the synthetic MCP module does not exist.

- [ ] **Step 3: Implement the MCP factory and direct entry point**

```ts
export function createSyntheticSupportAutopilotMcpServer(): McpServer {
  const server = new McpServer({ name: "support-autopilot-synthetic", version: "0.1.0" });
  registerSupportAutopilotTools(server, new SyntheticSupportAutopilotApi());
  return server;
}

if (invokedDirectly) {
  await createSyntheticSupportAutopilotMcpServer().connect(new StdioServerTransport());
}
```

Use the same `pathToFileURL(process.argv[1])` direct-invocation guard as the production launcher. Do not read environment variables in this entry point.

- [ ] **Step 4: Run the focused MCP tests**

Run: `corepack pnpm vitest run test/synthetic-support-autopilot-mcp.test.ts test/support-autopilot-tools.test.ts`

Expected: PASS with exactly seven registered tools.

- [ ] **Step 5: Commit the MCP entry point**

```powershell
git add src/synthetic/synthetic-support-autopilot-mcp.ts test/synthetic-support-autopilot-mcp.test.ts
git commit -m "feat(support): expose synthetic autopilot MCP"
```

### Task 4: Add Synthetic Configuration and Preflight

**Files:**
- Create: `src/synthetic/support-autopilot-synthetic-canary.config.ts`
- Create: `src/synthetic/codex-synthetic-preflight.ts`
- Create: `test/support-autopilot-synthetic-canary.config.test.ts`
- Create: `test/codex-synthetic-preflight.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Define a valid environment using only `SUPPORT_AUTOPILOT_SYNTHETIC_*` keys and assert normalized paths. Add table tests rejecting each forbidden production variable even when it contains a non-secret placeholder:

```ts
for (const key of [
  "ADMIN_API_BASE_URL",
  "ADMIN_API_TOKEN",
  "SUPPORT_AUTOPILOT_SERVICE_TOKEN",
  "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
]) {
  expect(() => loadSupportAutopilotSyntheticCanaryConfig({
    ...baseEnvironment,
    [key]: "forbidden",
  }, "C:\\repo")).toThrow("Production configuration is forbidden");
}
```

Also reject WindowsApps Codex, relative paths, repo-contained home/runtime, identical home/runtime, invalid worker id, timeout outside `30000..600000`, and any enable value other than exact `true`.

- [ ] **Step 2: Run the config tests and verify RED**

Run: `corepack pnpm vitest run test/support-autopilot-synthetic-canary.config.test.ts`

Expected: FAIL because the config module does not exist.

- [ ] **Step 3: Implement the config loader**

Return `{ enabled: false }` unless the enable value is exact `true`. When enabled, reject forbidden keys before reading paths. Require absolute Windows paths for Codex, Node, synthetic home, empty runtime, and compiled MCP entry. Normalize paths, enforce isolation, validate the worker id with the production pattern, and parse the bounded timeout.

- [ ] **Step 4: Write failing preflight tests**

Create temporary files/directories and a fake process runner returning valid version, login status, and MCP JSON. Assert three commands run in order and every command receives only the minimal child environment:

```ts
expect(inputs.map((input) => input.args)).toEqual([
  ["--version"],
  ["login", "status"],
  ["mcp", "list", "--json"],
]);
expect(JSON.stringify(inputs.map((input) => input.environment)))
  .not.toMatch(/ADMIN_API|TOKEN|CREDENTIAL|SERVICE/i);
```

Add failures for non-empty runtime, missing files, API-key login, extra MCP, wrong command/entry path, MCP cwd, MCP env/env_vars, command timeout, malformed JSON, and nonzero exit.

- [ ] **Step 5: Run the preflight test and verify RED**

Run: `corepack pnpm vitest run test/codex-synthetic-preflight.test.ts`

Expected: FAIL because the preflight module does not exist.

- [ ] **Step 6: Implement the minimal preflight**

Export `createSyntheticCodexChildEnvironment(config)` with only `CODEX_HOME`, `APPDATA`, `ComSpec`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SystemRoot`, `TEMP`, `TMP`, `USERPROFILE`, and `WINDIR`. Validate filesystem, `codex-cli` version format, exact `Logged in using ChatGPT`, and one enabled stdio server named `support-autopilot` whose command and sole argument match Node and the compiled synthetic MCP entry.

Collapse all errors to `SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED`.

- [ ] **Step 7: Run config and preflight tests**

Run: `corepack pnpm vitest run test/support-autopilot-synthetic-canary.config.test.ts test/codex-synthetic-preflight.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit configuration and preflight**

```powershell
git add src/synthetic/support-autopilot-synthetic-canary.config.ts src/synthetic/codex-synthetic-preflight.ts test/support-autopilot-synthetic-canary.config.test.ts test/codex-synthetic-preflight.test.ts
git commit -m "feat(support): guard synthetic Codex profile"
```

### Task 5: Add the Foreground Synthetic Canary Command

**Files:**
- Create: `src/synthetic/support-autopilot-synthetic-canary-main.ts`
- Create: `test/support-autopilot-synthetic-canary-main.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing command tests**

Dependency-inject config loading, preflight, and decision execution. Test dormant behavior and one successful run:

```ts
expect(await runSupportAutopilotSyntheticCanary({}, {
  execute: async () => ({ failedToolCalls: 0, successfulDecisionSubmissions: 1, toolCalls: 4, totalLines: 8 }),
  loadConfig: () => config,
  preflight: { run: async () => ({ outcome: "ready" }) },
})).toMatchObject({ outcome: "passed", failedToolCalls: 0, successfulDecisionSubmissions: 1, toolCalls: 4 });
```

Assert preflight occurs before execution, failures collapse to `SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_FAILED`, and serialized success contains none of `ticket`, `message`, `lease`, `reply`, `stdout`, `stderr`, `token`, or fictional fixture text.

- [ ] **Step 2: Run the command test and verify RED**

Run: `corepack pnpm vitest run test/support-autopilot-synthetic-canary-main.test.ts`

Expected: FAIL because the main module does not exist.

- [ ] **Step 3: Implement one-run foreground orchestration**

Load config, return `{ outcome: "disabled" }` without side effects when disabled, run synthetic preflight, invoke `runCodexSupportDecision` with the minimal child environment, and return only:

```ts
{
  durationMs,
  failedToolCalls: 0,
  outcome: "passed",
  successfulDecisionSubmissions: 1,
  toolCalls,
}
```

The direct entry point prints `JSON.stringify(summary)` once. It has no polling, retry, scheduler, credential provider, backend client, or logger for raw errors.

- [ ] **Step 4: Add the package script**

```json
"support-autopilot:synthetic-canary": "node dist/synthetic/support-autopilot-synthetic-canary-main.js"
```

- [ ] **Step 5: Run command and related tests**

Run: `corepack pnpm vitest run test/support-autopilot-synthetic-canary-main.test.ts test/codex-support-decision-execution.test.ts test/codex-shadow-worker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the command**

```powershell
git add src/synthetic/support-autopilot-synthetic-canary-main.ts test/support-autopilot-synthetic-canary-main.test.ts package.json
git commit -m "feat(support): add offline synthetic canary command"
```

### Task 6: Document, Verify, and Run the Real Synthetic Canary

**Files:**
- Modify: `docs/support-autopilot-unit5-shadow-runner.md`
- Modify if required by verification: files from Tasks 1-5 only

- [ ] **Step 1: Add the offline synthetic runbook**

Document that the synthetic path is allowed before privacy attestation only because it contains fictional data. Include the dedicated directories, auth-copy rule, exact one-server MCP registration, forbidden production variables, build command, foreground run command, expected redacted JSON fields, and cleanup steps.

- [ ] **Step 2: Run static and automated verification**

Run:

```powershell
corepack pnpm verify
git diff --check
```

Expected: TypeScript typecheck/build PASS, all Vitest files PASS, and no whitespace errors.

- [ ] **Step 3: Build and prepare the isolated synthetic profile**

Create `C:\Users\Arkadiy\.sdelka-support-autopilot\synthetic-codex-home` and `synthetic-runtime-empty`. Copy only `auth.json` from the authenticated support home without reading it, restrict both directories and files to the current Windows identity plus `SYSTEM`, and register exactly one MCP:

```powershell
$env:CODEX_HOME='C:\Users\Arkadiy\.sdelka-support-autopilot\synthetic-codex-home'
& $codex mcp add support-autopilot -- $node `
  'C:\Users\Arkadiy\.sdelka-support-autopilot\worktrees\admin-mcp-synthetic-canary\dist\synthetic\synthetic-support-autopilot-mcp.js'
```

Verify `codex login status` and `codex mcp list --json` without printing auth contents.

- [ ] **Step 4: Run one real Codex synthetic canary**

Clear the four forbidden production variables from the child shell, set only the `SUPPORT_AUTOPILOT_SYNTHETIC_*` configuration, and run:

```powershell
corepack pnpm support-autopilot:synthetic-canary
```

Expected: one JSON object with `outcome="passed"`, zero failed tool calls, exactly one successful decision submission, and no raw prompt, fixture content, lease, reply, stdout, stderr, token, or backend URL.

- [ ] **Step 5: Inspect security invariants after the run**

Verify no `ADMIN_API_BASE_URL`, DPAPI credential, production launcher, customer file, budget file, scheduled task, service, or persistent process exists in the synthetic profile. Confirm the production support `CODEX_HOME`, production flags, and credential directory were not modified.

- [ ] **Step 6: Commit documentation and final corrections**

```powershell
git add docs/support-autopilot-unit5-shadow-runner.md src test package.json
git commit -m "docs(support): document offline synthetic canary"
```

- [ ] **Step 7: Final review before PR**

Run:

```powershell
corepack pnpm verify
git diff main...HEAD --check
git status --short
git log --oneline main..HEAD
```

Expected: full verification passes, worktree is clean, and commits are limited to the synthetic canary design, implementation, tests, and runbook.
