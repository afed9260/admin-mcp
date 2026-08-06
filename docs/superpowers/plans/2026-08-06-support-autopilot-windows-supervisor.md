# Support Autopilot Windows Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Install a recoverable watchdog and dedicated credential supervisor for
the current Windows user while preserving all existing support-autopilot safety
boundaries.

**Architecture:** Testable TypeScript policy and journal helpers own timing,
state validation, and GitHub-run correlation. Narrow PowerShell entry points own
Windows process control, DPAPI candidate generation, atomic file promotion, and
Task Scheduler registration. The existing production workflow remains the only
server-side credential mutation path and gains a request-id correlation input.

**Tech Stack:** TypeScript, Vitest, Node.js 22, Windows PowerShell 5.1, Windows
Task Scheduler, GitHub CLI, GitHub Actions.

---

## Task 1: Add Rotation Policy And Journal Contracts

**Files:**

- Create: `src/runner/support-autopilot-credential-supervisor.ts`
- Create: `test/support-autopilot-credential-supervisor.spec.ts`

- [ ] Write failing tests for strict non-secret metadata parsing, six-hour
  renewal timing, recoverable stages, and exact GitHub run selection.
- [ ] Run `corepack pnpm vitest run test/support-autopilot-credential-supervisor.spec.ts`
  and verify the new tests fail because the module is absent.
- [ ] Implement the minimum pure TypeScript contracts and selectors.
- [ ] Rerun the focused test and verify it passes.
- [ ] Commit the policy and tests.

## Task 2: Add Safe Local Health Probe

**Files:**

- Create: `src/runner/support-autopilot-local-health-main.ts`
- Create: `test/support-autopilot-local-health-main.spec.ts`
- Modify: `package.json`

- [ ] Write failing tests proving exact health-shape validation and redacted
  failure output.
- [ ] Run the focused test and verify it fails before implementation.
- [ ] Load the DPAPI credential through the existing provider, call only the
  dedicated health route, validate the exact response, and emit a sanitized
  readiness object. Never print the token, endpoint response body, or raw error.
- [ ] Add the package entry point and rerun the tests.
- [ ] Commit the probe and tests.

## Task 3: Add Windows Runner Lifecycle Scripts

**Files:**

- Create: `scripts/start-support-autopilot-shadow-runner.ps1`
- Create: `scripts/stop-support-autopilot-shadow-runner.ps1`
- Create: `test/windows-support-autopilot-scripts.spec.ts`

- [ ] Add static failing tests for exact process matching, hidden launch,
  bounded stop verification, and redacted log paths.
- [ ] Run the script spec and verify it fails before scripts exist.
- [ ] Canonicalize the reviewed launcher and add the bounded stop script.
- [ ] Rerun the script spec and perform a local plan-only invocation.
- [ ] Commit the lifecycle scripts and tests.

## Task 4: Add Recoverable Credential Rotation Script

**Files:**

- Create: `scripts/invoke-support-autopilot-credential-supervisor.ps1`
- Modify: `test/windows-support-autopilot-scripts.spec.ts`

- [ ] Extend script specs for locking, journal recovery, no raw-token arguments,
  exact workflow correlation, atomic promotion, and redacted events.
- [ ] Run the focused spec and verify failure.
- [ ] Implement the supervisor using the TypeScript policy module and existing
  DPAPI generator.
- [ ] Rerun focused tests and a local no-mutation plan invocation.
- [ ] Commit the rotation script and tests.

## Task 5: Add Scheduled Task Installer

**Files:**

- Create: `scripts/install-support-autopilot-scheduled-tasks.ps1`
- Create: `scripts/uninstall-support-autopilot-scheduled-tasks.ps1`
- Modify: `test/windows-support-autopilot-scripts.spec.ts`

- [ ] Extend script specs for the two exact task names, interactive-token
  principal, least privilege, repeated triggers, `StartWhenAvailable`, and
  `IgnoreNew`.
- [ ] Run the focused spec and verify failure.
- [ ] Implement idempotent install and uninstall scripts with a plan-only mode.
- [ ] Rerun tests and inspect plan-only task definitions for secrets.
- [ ] Commit the task lifecycle scripts and tests.

## Task 6: Add Exact Workflow Correlation

**Repository:** `afed9260/ai-agent-backend`

**Files:**

- Modify: `.github/workflows/support-autopilot-credential-rotation.yml`
- Modify: `src/scripts-specs/support-autopilot-credential-rotation.workflow.spec.ts`
- Modify: `docs/playbooks/support-autopilot-credential-rotation.md`

- [ ] Add failing workflow assertions for required canonical `request_id`, the
  deterministic run name, and validation before the guarded shell script.
- [ ] Run `node --max-old-space-size=8192 node_modules/jest/bin/jest.js --runInBand
  support-autopilot-credential-rotation.workflow.spec.ts` and verify failure.
- [ ] Modify only the workflow and playbook; do not change the guarded mutation
  script or managed variables.
- [ ] Rerun the focused workflow spec and tracked-secret guard.
- [ ] Commit the backend correlation contract.

## Task 7: Document And Verify

**Files:**

- Modify: `docs/support-autopilot-unit5-shadow-runner.md`

- [ ] Update the runner runbook with installation, recovery, and limitations.
- [ ] Run focused tests and full `corepack pnpm verify` in `admin-mcp`.
- [ ] Run the backend workflow spec, build, tracked-secret guard, and diff check.
- [ ] Self-review both branch diffs and obtain an independent code review.
- [ ] Open and merge reviewed PRs, then fast-forward the installed checkout.

## Task 8: Install And Prove Local Operation

- [ ] Seed the current non-secret expiry metadata and install both tasks.
- [ ] Inspect task definitions and exported XML for secret-free arguments.
- [ ] Stop the manually started runner and prove watchdog recovery.
- [ ] Execute a no-rotation supervisor cycle.
- [ ] Perform one guarded real rotation and verify the correlated successful run,
  the new local readiness event, queue health, and public production health.

## Task 9: Cleanup

- [ ] Confirm both canonical checkouts are clean and on `main`.
- [ ] Remove task worktrees and merged temporary branches.
- [ ] Retain only the canonical credential plus one encrypted rollback blob.
- [ ] Report the remaining requirement that the PC and interactive Windows
  session must be available.
