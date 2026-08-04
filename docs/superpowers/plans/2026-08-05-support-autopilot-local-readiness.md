# Support Autopilot Local Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a redacted, offline production-shadow readiness command that reports exact local blockers without credentials, backend calls, runner startup, or customer data.

**Architecture:** Extract pure validation rules already enforced by production preflight, then compose them in a separate advisory doctor. Keep process execution behind the existing `CodexProcessRunner`; keep production smoke and launch authority in `CodexShadowPreflight`.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, pnpm.

---

## File Structure

- Create `src/runner/codex-profile-validation.ts`: pure Codex version, login, and exact MCP-profile validators.
- Create `src/runner/support-privacy-attestation.ts`: pure privacy-attestation parser and validator.
- Modify `src/runner/codex-shadow-preflight.ts`: delegate existing rules to shared validators without changing preflight order or failure contract.
- Modify `src/synthetic/codex-synthetic-preflight.ts`: delegate overlapping Codex profile rules to the same validators.
- Create `src/runner/support-autopilot-readiness.config.ts`: tolerant parsing of non-secret diagnostic inputs.
- Create `src/runner/support-autopilot-readiness.ts`: six independent, read-only checks and redacted report assembly.
- Create `src/runner/support-autopilot-readiness-main.ts`: foreground JSON entry point and bounded exit behavior.
- Modify `package.json`: expose `support-autopilot:readiness`.
- Modify `docs/support-autopilot-unit5-shadow-runner.md`: document invocation, report semantics, and advisory boundary.
- Create focused tests for shared validators, config, doctor, and main orchestration.

### Task 1: Shared Validation Rules

**Files:**
- Create: `src/runner/codex-profile-validation.ts`
- Create: `src/runner/support-privacy-attestation.ts`
- Create: `test/codex-profile-validation.test.ts`
- Create: `test/support-privacy-attestation.test.ts`
- Modify: `src/runner/codex-shadow-preflight.ts`
- Modify: `src/synthetic/codex-synthetic-preflight.ts`

- [ ] **Step 1: Write failing pure-validator tests**

Test exact valid values plus malformed version output, API-key login, extra MCP servers, configured MCP environment, mismatched paths, wrong attestation keys, expired attestations, and Pro workspaces without `modelTrainingDisabled=true`.

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm vitest run test/codex-profile-validation.test.ts test/support-privacy-attestation.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement minimal pure validators**

Export assertion functions that accept already-read strings/unknown JSON and expected paths or attestation identity. Throw bounded internal errors and never include input values.

- [ ] **Step 4: Migrate both preflights**

Replace duplicate validation expressions with shared assertions. Preserve existing public errors `SUPPORT_AUTOPILOT_PREFLIGHT_FAILED` and `SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED` and preserve process order.

- [ ] **Step 5: Verify GREEN and regressions**

Run: `corepack pnpm vitest run test/codex-profile-validation.test.ts test/support-privacy-attestation.test.ts test/codex-shadow-preflight.test.ts test/codex-synthetic-preflight.test.ts`

Expected: all tests pass.

### Task 2: Tolerant Readiness Configuration

**Files:**
- Create: `src/runner/support-autopilot-readiness.config.ts`
- Create: `test/support-autopilot-readiness.config.test.ts`

- [ ] **Step 1: Write failing config tests**

Specify that standard production-shadow path variables are reused, absent/invalid values remain represented for diagnostic blocker reporting, timeout defaults to 120000 ms, and either plaintext token variable sets `plaintextTokenPresent=true` without retaining the token value.

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm vitest run test/support-autopilot-readiness.config.test.ts`

Expected: FAIL because the config module is absent.

- [ ] **Step 3: Implement minimal config loader**

Normalize valid absolute Windows paths, canonical expected expiry, and bounded timeout. Store only booleans for secret presence. Do not read files or spawn processes.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm vitest run test/support-autopilot-readiness.config.test.ts`

Expected: all tests pass.

### Task 3: Readiness Doctor And Foreground Command

**Files:**
- Create: `src/runner/support-autopilot-readiness.ts`
- Create: `src/runner/support-autopilot-readiness-main.ts`
- Create: `test/support-autopilot-readiness.test.ts`
- Create: `test/support-autopilot-readiness-main.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing doctor tests**

Define the exact six-check report. Cover a ready profile, all missing inputs, plaintext-token short circuit, invalid filesystem entries, non-empty runtime, invalid login/MCP output, missing credential, invalid attestation, minimal process environment, and absence of paths/raw output in serialized reports.

- [ ] **Step 2: Verify RED**

Run: `corepack pnpm vitest run test/support-autopilot-readiness.test.ts test/support-autopilot-readiness-main.test.ts`

Expected: FAIL because doctor and main modules are absent.

- [ ] **Step 3: Implement the read-only doctor**

Use `stat`, `readdir`, and `readFile` only for their designated checks. Call Codex only when executable, home, and runtime prerequisites are valid. Never read the credential blob. Continue independent checks safely and sort/deduplicate blocker codes.

- [ ] **Step 4: Implement bounded CLI behavior**

Print one JSON report. Return exit code 0 for `ready`, 2 for `blocked`, and print only `SUPPORT_AUTOPILOT_READINESS_FAILED` with exit code 1 for unexpected orchestration failures.

- [ ] **Step 5: Verify GREEN**

Run: `corepack pnpm vitest run test/support-autopilot-readiness.test.ts test/support-autopilot-readiness-main.test.ts`

Expected: all tests pass.

### Task 4: Documentation And End-To-End Verification

**Files:**
- Modify: `docs/support-autopilot-unit5-shadow-runner.md`

- [ ] **Step 1: Document the command**

Add the required non-secret environment variables, report schema, exit codes, advisory status, and explicit statement that the command does not decrypt credentials, contact the backend, start a runner, or approve privacy controls.

- [ ] **Step 2: Run the complete verification suite**

Run: `corepack pnpm verify`

Expected: typecheck, all Vitest tests, and build pass.

- [ ] **Step 3: Run the local readiness audit**

Build and invoke the command against the existing local production-shadow Codex home, runtime, Node executable, built launcher, and standalone Codex CLI. Point the optional credential and attestation settings only at their intended current locations; do not create either file.

Expected: local CLI/login/MCP/runtime checks are ready; genuinely absent credential and attestation checks are blocked; output contains no path, token, backend URL, or raw command output.

- [ ] **Step 4: Review repository state**

Run: `git diff --check && git status --short && git diff --stat main...HEAD`

Expected: no whitespace errors, only scoped files changed, and no generated `dist` or `node_modules` changes tracked.
