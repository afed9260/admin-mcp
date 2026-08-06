# Support Autopilot Windows Supervisor Design

## Goal

Keep the support shadow runner available on Arkadiy's existing Windows Pro
workspace and rotate its dedicated short-lived service credential before expiry
without introducing another Windows account, API-model billing, plaintext
credentials, or access to customer/provider credentials.

## Constraints

- The computer must be powered on and Arkadiy must be logged in. This design
  deliberately uses the existing interactive Windows identity because the
  Codex Pro login and DPAPI blob are scoped to that identity.
- The runner remains shadow-only. It may record an internal decision and send
  the existing owner notification, but it cannot reply to a customer or mutate
  a ticket.
- The service credential is separate from Avito, CIAN, Telegram provider,
  customer authorization, billing, and the internal backend token.
- No raw service token may enter GitHub Actions, command arguments, logs, state
  files, task definitions, or operator output.
- Production credential changes continue through the existing guarded
  `support-autopilot-credential-rotation.yml` workflow.

## Chosen Architecture

Use two Windows Task Scheduler tasks under the current interactive identity.

1. **Runner watchdog** runs at logon and every five minutes. It invokes an
   idempotent launcher. If the reviewed runner process already exists, it does
   nothing. Otherwise it starts the runner hidden with the isolated Codex home,
   empty runtime, DPAPI credential, privacy attestation, and redacted logs.
2. **Credential supervisor** runs at logon and every fifteen minutes. It reads only non-secret
   rotation metadata. When fewer than six hours remain, it performs the guarded
   rotation state machine described below. Otherwise it exits without network
   or process changes.

Task actions contain only absolute script paths and bounded non-secret
parameters. Both tasks use `InteractiveToken`, least privilege, `StartWhenAvailable`,
and `IgnoreNew`, so they neither store a Windows password nor overlap with
themselves.

## Credential Rotation State Machine

The supervisor maintains a user-only JSON journal outside all repositories and
runtime directories. It stores timestamps, a random request id, the candidate
path, the token SHA-256 digest, the correlated workflow run id, and a bounded
stage. It never stores the token.

1. Acquire a local exclusive lock. If another rotation owns it, exit.
2. Recover an interrupted journal before starting new work.
3. Query the dedicated support-automation health boundary using the current
   DPAPI credential. Continue only when `activeLeases=0` and the runner gates are
   ready.
4. Request a graceful runner drain. The runner checks the request before
   starting work, finishes an in-flight decision, exits, and is followed by a
   second `activeLeases=0` check.
5. Generate a non-overwriting DPAPI candidate with the existing cryptographic
   generator. Persist only its digest and bounded issue/expiry timestamps.
6. Persist `dispatch_prepared`, search for an already-created exact run after
   recovery, then dispatch the guarded production workflow with the digest,
   timestamps, and a random request id only when needed. The workflow run name includes that request id. The local
   supervisor accepts exactly one completed successful run from the immutable
   `support-autopilot-credential-rotation-v1` tag at its expected commit SHA.
7. Atomically move the current canonical DPAPI blob to an encrypted backup and
   promote the candidate. If the promotion fails, retain the journal and retry
   recovery; never print either blob.
8. Record the current heartbeat and launch the runner through the bounded Node
   process launcher. The launcher detaches the runner with stdin, stdout, and
   stderr bound only to protected files, then exits. The supervisor observes
   the exact new PID directly, waits for the transient PowerShell helper to
   exit, and verifies its exit code and returned PID before releasing the
   rotation lock. A timed-out helper is terminated by exact PID and awaited so
   it cannot launch later. A post-termination scan contains any exact runner
   PID that was absent before the helper, closing the detached-child boundary
   race. Existing idle stale runners are drained and replaced by the canonical
   start script before verification. The supervisor then requires the authenticated dedicated health
   response to report `runnerReady=true` plus a heartbeat newer than the
   pre-start baseline. Only then mark the new credential active and remove
   stale encrypted backups beyond the retained rollback copy. The supervisor
   never reads the live redirected stderr file as a readiness boundary.

If GitHub rejects or fails the rotation, the canonical blob remains unchanged
and the old runner is restarted. If the server accepted the candidate but the
local process was interrupted, the journal resumes candidate promotion and
runner verification. If the accepted candidate is unavailable, the next run
issues a fresh candidate and performs a second guarded rotation instead of
trying to reconstruct a secret.

## GitHub Correlation Contract

The production workflow gains one required `request_id` input matching a
canonical UUID and a deterministic run name. No production mutation semantics
change. The workflow still receives only the digest and timestamps and still
changes only the four managed `SUPPORT_AUTOPILOT_*` values in Admin.

The local supervisor resolves the immutable workflow tag, searches by the exact
run name, rejects zero or multiple matching runs after the bounded discovery
window, and verifies `headBranch`, `headSha`, `event`, terminal status, and
conclusion before promoting the candidate. Queued runs are cancelled after a
bounded wait and the old runner is restored only after terminal failure and a
successful old-credential health check.

## Local Files

All mutable files remain under `C:\Users\Arkadiy\.sdelka-support-autopilot`:

- `credentials\support-autopilot.dpapi`: canonical DPAPI blob;
- `credentials\candidate-<request-id>.dpapi`: temporary candidate;
- `state\credential-rotation.json`: non-secret durable journal;
- `state\credential-rotation.lock`: exclusive local lock;
- `state\credential-rotation.events.jsonl`: redacted event codes only;
- `state\shadow-runner.stdin`: empty detached-process input;
- `state\shadow-runner.stderr.log`: existing redacted runner events;
- `state\runner-start.stdout.log` and `runner-start.stderr.log`: bounded
  helper diagnostics without prompts, ticket contents, or credentials;
- `state\shadow-runner.drain`: non-secret graceful-stop request.

User-only ACLs are required for the credential, state, and log paths. The empty
runtime remains empty.

## Failure Handling

- Server unavailable, GitHub unavailable, or runner busy: no credential change;
  retry on the next fifteen-minute trigger.
- Workflow failed with a valid old credential: confirm its dedicated health,
  then remove the candidate and restart the old runner. With an expired old
  credential, preserve the journal and candidate for audited recovery.
- Server accepted but local promotion/start failed: retain the journal and
  candidate for deterministic recovery.
- Credential expired before recovery: runner stays stopped, waits thirty
  minutes for the maximum lease lifetime, then rotates through GitHub without
  requiring the expired credential.
- Correlation ambiguity, changed workflow SHA, unexpected response shape, or
  plaintext token environment: fail closed and record a redacted blocker.
- A queued workflow may be cancelled after a bounded wait. An in-progress
  workflow is never cancelled by the local timeout; its recovery state remains
  intact until the exact run reaches a terminal state.

## Verification

- Unit tests cover rotation timing, journal validation, interrupted-stage
  recovery, exact workflow-run correlation, and ambiguous/failing runs.
- Executable Windows tests exercise graceful drain and the complete journal,
  DPAPI generation/promotion, correlated workflow, rollback, and restart path
  with guarded local fakes. Static tests retain the no-secret and task checks.
- Local acceptance installs the tasks, proves their definitions contain no
  secret, restarts the runner through the watchdog, and runs a no-rotation
  supervisor cycle against the current unexpired credential.
- A guarded real rotation is accepted only after the new runner reaches ready
  state and the production health boundary succeeds.

## Risks And Trade-offs

- The support autopilot pauses while Windows is off or Arkadiy is logged out.
  This is accepted to preserve the current Pro login and avoid a second account.
- A successful credential rotation briefly recreates Admin and restarts the
  local runner. Guarded server rollback and the local idle gate bound the risk.
- Task Scheduler is local infrastructure. Reinstalling Windows requires rerunning
  the installer; the versioned scripts and runbook make that reproducible.
- Failure visibility is initially local (Task Scheduler result plus redacted
  event journal). Remote operational alerting is intentionally deferred because
  it would require a separate authenticated notification channel.

## Non-goals

- Customer auto-replies or ticket mutation.
- Automatic changes to privacy approval or model-training controls.
- Rotation of Avito, CIAN, Telegram, billing, user authorization, or backend
  internal tokens.
- Running while no interactive Windows session exists.
- Automatic deployment of new runner code.
