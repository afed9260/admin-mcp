import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";

export const RUNTIME_MANIFEST_SCHEMA = "support-autopilot-runtime-manifest.v1";

export interface SupportAutopilotRuntimeManifest {
  files: Array<{ path: string; sha256: string }>;
  revision: string;
  schema: typeof RUNTIME_MANIFEST_SCHEMA;
}

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "skills/sdelka-support-autopilot/SKILL.md",
] as const;

export function createSupportAutopilotRuntimeManifest(
  root: string,
  revision: string,
): SupportAutopilotRuntimeManifest {
  assertRevision(revision);
  const canonicalRoot = validateRoot(root);
  const relativePaths = collectRuntimePaths(canonicalRoot);
  return {
    files: relativePaths.map((relativePath) => ({
      path: relativePath,
      sha256: hashRuntimeFile(canonicalRoot, relativePath),
    })),
    revision,
    schema: RUNTIME_MANIFEST_SCHEMA,
  };
}

export function verifySupportAutopilotRuntimeManifest(
  root: string,
  manifest: unknown,
  expectedRevision: string,
): void {
  assertRevision(expectedRevision);
  const parsed = parseManifest(manifest);
  if (parsed.revision !== expectedRevision) {
    throw new Error("RUNTIME_REVISION_MISMATCH");
  }

  const current = createSupportAutopilotRuntimeManifest(root, expectedRevision);
  if (current.files.length !== parsed.files.length) {
    throw new Error("RUNTIME_FILE_SET_MISMATCH");
  }
  for (let index = 0; index < current.files.length; index += 1) {
    const expected = parsed.files[index];
    const actual = current.files[index];
    if (actual?.path !== expected?.path) {
      throw new Error("RUNTIME_FILE_SET_MISMATCH");
    }
    if (actual.sha256 !== expected.sha256) {
      throw new Error("RUNTIME_FILE_HASH_MISMATCH");
    }
  }
}

function assertRevision(revision: string): void {
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
}

function validateRoot(root: string): string {
  if (!path.isAbsolute(root) || root.includes("\0")) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  const normalized = path.resolve(root);
  const rootStats = safeLstat(normalized);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  return realpathSync.native(normalized);
}

function collectRuntimePaths(root: string): string[] {
  const files: string[] = [];
  walkRuntimeDirectory(root, "dist", files);

  const scriptsDirectory = resolveRuntimePath(root, "scripts");
  assertDirectory(scriptsDirectory);
  for (const entry of readdirSync(scriptsDirectory, { withFileTypes: true })) {
    if (!entry.name.includes("support-autopilot") || !entry.name.endsWith(".ps1")) {
      continue;
    }
    const relativePath = `scripts/${entry.name}`;
    assertRegularRuntimeFile(root, relativePath);
    files.push(relativePath);
  }

  for (const relativePath of REQUIRED_FILES) {
    assertRegularRuntimeFile(root, relativePath);
    files.push(relativePath);
  }

  files.sort();
  if (new Set(files).size !== files.length) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  return files;
}

function walkRuntimeDirectory(root: string, relativeDirectory: string, files: string[]): void {
  const absoluteDirectory = resolveRuntimePath(root, relativeDirectory);
  assertDirectory(absoluteDirectory);
  const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const absolutePath = resolveRuntimePath(root, relativePath);
    const stats = safeLstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    if (stats.isDirectory()) {
      walkRuntimeDirectory(root, relativePath, files);
      continue;
    }
    if (!stats.isFile()) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    files.push(relativePath);
  }
}

function hashRuntimeFile(root: string, relativePath: string): string {
  const absolutePath = assertRegularRuntimeFile(root, relativePath);
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function assertRegularRuntimeFile(root: string, relativePath: string): string {
  assertManifestPath(relativePath);
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    const stats = safeLstat(current);
    if (stats.isSymbolicLink()) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    const final = index === segments.length - 1;
    if ((final && !stats.isFile()) || (!final && !stats.isDirectory())) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
  }
  assertContainedRealPath(root, current);
  return current;
}

function assertDirectory(absolutePath: string): void {
  const stats = safeLstat(absolutePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
}

function safeLstat(absolutePath: string): Stats {
  try {
    return lstatSync(absolutePath);
  } catch {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
}

function resolveRuntimePath(root: string, relativePath: string): string {
  assertManifestPath(relativePath);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  return absolutePath;
}

function assertContainedRealPath(root: string, absolutePath: string): void {
  const realPath = realpathSync.native(absolutePath);
  const relative = path.relative(root, realPath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
}

function parseManifest(manifest: unknown): SupportAutopilotRuntimeManifest {
  if (!isRecordWithExactKeys(manifest, ["files", "revision", "schema"])) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  if (
    manifest.schema !== RUNTIME_MANIFEST_SCHEMA
    || typeof manifest.revision !== "string"
    || !REVISION_PATTERN.test(manifest.revision)
    || !Array.isArray(manifest.files)
  ) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }

  let previousPath: string | null = null;
  const files = manifest.files.map((entry) => {
    if (
      !isRecordWithExactKeys(entry, ["path", "sha256"])
      || typeof entry.path !== "string"
      || typeof entry.sha256 !== "string"
      || !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    assertManifestPath(entry.path);
    if (previousPath !== null && previousPath >= entry.path) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    previousPath = entry.path;
    return { path: entry.path, sha256: entry.sha256 };
  });
  return { files, revision: manifest.revision, schema: RUNTIME_MANIFEST_SCHEMA };
}

function assertManifestPath(relativePath: string): void {
  if (
    relativePath.length === 0
    || relativePath.includes("\0")
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || /^[a-zA-Z]:/.test(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some(segment => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
}

function isRecordWithExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
