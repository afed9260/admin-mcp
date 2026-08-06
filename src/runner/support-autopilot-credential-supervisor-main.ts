import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  credentialTokenMatchesDigest,
  type CredentialRotationRecoveryAction,
  locateCredentialRotationRun,
  parseCredentialRotationState,
  parseGeneratedCredentialMetadata,
  planCredentialRotationRecovery,
  selectCredentialRotationRun,
  shouldRotateCredential,
} from "./support-autopilot-credential-supervisor.js";
import { WindowsDpapiSecretProvider } from "./windows-dpapi-secret-provider.js";

type JsonReader = (filePath: string) => Promise<unknown>;

export interface CredentialSupervisorCommandDependencies {
  pathExists?: (filePath: string) => boolean;
  readJsonFile?: JsonReader;
  secretProvider?: Pick<WindowsDpapiSecretProvider, "read">;
}

export type CredentialSupervisorCommandResult =
  | { action: CredentialRotationRecoveryAction }
  | { found: false }
  | { matches: true }
  | { status: string; workflowRunId: number }
  | { pendingRotation: boolean; rotate: boolean; seedRequired?: true }
  | { valid: true }
  | { workflowRunId: number };

export async function runCredentialSupervisorCommand(
  args: readonly string[],
  dependencies: CredentialSupervisorCommandDependencies = {},
): Promise<CredentialSupervisorCommandResult> {
  try {
    const [command, ...optionArgs] = args;
    const options = parseOptions(optionArgs);
    const readJsonFile = dependencies.readJsonFile ?? readBoundedJsonFile;

    if (command === "decision") {
      assertOnlyOptions(options, ["credential-root", "now", "state"]);
      const state = parseCredentialRotationState(
        await readJsonFile(requiredOption(options, "state")),
        requiredOption(options, "credential-root"),
      );
      if (state.activeCredential === null) {
        return {
          pendingRotation: state.pendingRotation !== null,
          rotate: false,
          seedRequired: true,
        };
      }
      const nowRaw = options.get("now");
      const now = nowRaw === undefined ? new Date() : canonicalDate(nowRaw);
      return {
        pendingRotation: state.pendingRotation !== null,
        rotate: shouldRotateCredential(state.activeCredential, now),
      };
    }

    if (command === "validate-state") {
      assertOnlyOptions(options, ["credential-root", "state"]);
      parseCredentialRotationState(
        await readJsonFile(requiredOption(options, "state")),
        requiredOption(options, "credential-root"),
      );
      return { valid: true };
    }

    if (command === "validate-generated") {
      assertOnlyOptions(options, ["metadata"]);
      parseGeneratedCredentialMetadata(
        await readJsonFile(requiredOption(options, "metadata")),
      );
      return { valid: true };
    }

    if (command === "recovery-action") {
      assertOnlyOptions(options, ["active-path", "credential-root", "state"]);
      const credentialRoot = windowsAbsolutePath(requiredOption(options, "credential-root"));
      const activePath = windowsAbsolutePath(requiredOption(options, "active-path"));
      const state = parseCredentialRotationState(
        await readJsonFile(requiredOption(options, "state")),
        credentialRoot,
      );
      if (state.pendingRotation === null) {
        throw new Error("pending rotation is required");
      }
      const pending = state.pendingRotation;
      const candidatePath = pending.stage === "runner_stopped"
        ? path.win32.join(credentialRoot, `candidate-${pending.requestId}.dpapi`)
        : pending.candidatePath;
      const candidateExists = (dependencies.pathExists ?? existsSync)(candidatePath);
      let activeMatchesCandidate: boolean | undefined;
      if (pending.stage === "server_accepted" && !candidateExists) {
        const secretProvider = dependencies.secretProvider ?? new WindowsDpapiSecretProvider();
        const activeToken = await secretProvider.read(activePath);
        activeMatchesCandidate = credentialTokenMatchesDigest(
          activeToken,
          pending.tokenSha256,
        );
      }
      return {
        action: planCredentialRotationRecovery(pending, {
          activeMatchesCandidate,
          candidateExists,
        }),
      };
    }

    if (command === "verify-candidate") {
      assertOnlyOptions(options, ["candidate-path", "digest"]);
      const candidatePath = windowsAbsolutePath(requiredOption(options, "candidate-path"));
      const digest = requiredOption(options, "digest");
      const secretProvider = dependencies.secretProvider ?? new WindowsDpapiSecretProvider();
      const token = await secretProvider.read(candidatePath);
      if (!credentialTokenMatchesDigest(token, digest)) {
        throw new Error("candidate digest mismatch");
      }
      return { matches: true };
    }

    if (command === "locate-run" || command === "probe-run" || command === "select-run") {
      assertOnlyOptions(options, ["expected-sha", "inventory", "request-id"]);
      const select = command === "locate-run" || command === "probe-run"
        ? locateCredentialRotationRun
        : selectCredentialRotationRun;
      let run;
      try {
        run = select(
          await readJsonFile(requiredOption(options, "inventory")),
          {
            expectedHeadSha: requiredOption(options, "expected-sha"),
            requestId: requiredOption(options, "request-id"),
          },
        );
      } catch (error) {
        if (
          command === "probe-run"
          && error instanceof Error
          && error.message === "credential rotation run not found"
        ) {
          return { found: false };
        }
        throw error;
      }
      return command === "locate-run" || command === "probe-run"
        ? { status: run.status, workflowRunId: run.databaseId }
        : { workflowRunId: run.databaseId };
    }

    throw new Error("unsupported command");
  } catch {
    throw new Error("SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED");
  }
}

function parseOptions(args: readonly string[]): Map<string, string> {
  if (args.length % 2 !== 0) {
    throw new Error("invalid options");
  }
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      key === undefined
      || value === undefined
      || !/^--[a-z][a-z-]*$/.test(key)
      || value.length === 0
      || options.has(key.slice(2))
    ) {
      throw new Error("invalid options");
    }
    options.set(key.slice(2), value);
  }
  return options;
}

function assertOnlyOptions(options: Map<string, string>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if ([...options.keys()].some((key) => !allowedSet.has(key))) {
    throw new Error("unexpected option");
  }
}

function requiredOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined) {
    throw new Error("missing option");
  }
  return value;
}

function canonicalDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("invalid date");
  }
  return parsed;
}

function windowsAbsolutePath(value: string): string {
  if (!path.win32.isAbsolute(value) || value.includes("\0")) {
    throw new Error("invalid path");
  }
  return path.win32.normalize(value);
}

async function readBoundedJsonFile(filePath: string): Promise<unknown> {
  const normalized = windowsAbsolutePath(filePath);
  const contents = await readFile(normalized, "utf8");
  if (contents.length === 0 || contents.length > 1024 * 1024) {
    throw new Error("invalid JSON file size");
  }
  return JSON.parse(contents) as unknown;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const result = await runCredentialSupervisorCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED\n");
    process.exitCode = 1;
  }
}
