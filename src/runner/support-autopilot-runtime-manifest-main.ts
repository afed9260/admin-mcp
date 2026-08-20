import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createSupportAutopilotRuntimeManifest,
  verifySupportAutopilotRuntimeManifest,
} from "./support-autopilot-runtime-manifest.js";

const FAILURE = "SUPPORT_AUTOPILOT_RUNTIME_MANIFEST_FAILED";
const MAX_MANIFEST_BYTES = 1024 * 1024;

export type SupportAutopilotRuntimeManifestCommandResult = {
  fileCount: number;
  outcome: "created" | "verified";
  revision: string;
};

export function runSupportAutopilotRuntimeManifestCommand(
  args: readonly string[],
): SupportAutopilotRuntimeManifestCommandResult {
  try {
    const [command, ...optionArgs] = args;
    if (command !== "create" && command !== "verify") throw new Error("invalid command");
    const requiredKeys = command === "create"
      ? ["root", "revision", "output"]
      : ["root", "revision", "manifest"];
    const options = parseExactOptions(optionArgs, requiredKeys);
    const root = absolutePath(options.get("root"));
    const revision = requiredOption(options, "revision");

    if (command === "create") {
      const output = absolutePath(options.get("output"));
      assertOutsideRuntime(root, output);
      const manifest = createSupportAutopilotRuntimeManifest(root, revision);
      writeManifestAtomically(output, manifest);
      return { fileCount: manifest.files.length, outcome: "created", revision };
    }

    const manifestPath = absolutePath(options.get("manifest"));
    assertOutsideRuntime(root, manifestPath);
    const manifest = readManifest(manifestPath);
    verifySupportAutopilotRuntimeManifest(root, manifest, revision);
    return {
      fileCount: (manifest as { files: unknown[] }).files.length,
      outcome: "verified",
      revision,
    };
  } catch {
    throw new Error(FAILURE);
  }
}

function parseExactOptions(args: readonly string[], requiredKeys: readonly string[]): Map<string, string> {
  if (args.length !== requiredKeys.length * 2) throw new Error("invalid options");
  const allowed = new Set(requiredKeys);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const rawKey = args[index];
    const value = args[index + 1];
    const key = rawKey?.startsWith("--") ? rawKey.slice(2) : "";
    if (!allowed.has(key) || options.has(key) || !value || value.includes("\0")) {
      throw new Error("invalid options");
    }
    options.set(key, value);
  }
  if (options.size !== requiredKeys.length) throw new Error("missing options");
  return options;
}

function requiredOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined) throw new Error("missing option");
  return value;
}

function absolutePath(value: string | undefined): string {
  if (value === undefined || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error("invalid path");
  }
  return path.resolve(value);
}

function assertOutsideRuntime(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error("manifest path must be outside runtime");
  }
}

function writeManifestAtomically(output: string, manifest: unknown): void {
  const parent = path.dirname(output);
  const parentStats = lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error("invalid output parent");
  }
  if (existsSync(output)) {
    const outputStats = lstatSync(output);
    if (!outputStats.isFile() || outputStats.isSymbolicLink()) {
      throw new Error("invalid output");
    }
  }
  const temporary = path.join(parent, `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readManifest(manifestPath: string): unknown {
  const stats = lstatSync(manifestPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MANIFEST_BYTES) {
    throw new Error("invalid manifest file");
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const result = runSupportAutopilotRuntimeManifestCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${FAILURE}\n`);
    process.exitCode = 1;
  }
}
