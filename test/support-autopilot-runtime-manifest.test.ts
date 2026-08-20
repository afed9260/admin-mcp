import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_MANIFEST_SCHEMA,
  createSupportAutopilotRuntimeManifest,
  verifySupportAutopilotRuntimeManifest,
} from "../src/runner/support-autopilot-runtime-manifest.js";
import {
  runSupportAutopilotRuntimeManifestCommand,
} from "../src/runner/support-autopilot-runtime-manifest-main.js";

const revision = "0123456789abcdef0123456789abcdef01234567";
const otherRevision = "89abcdef0123456789abcdef0123456789abcdef";
const temporaryRoots: string[] = [];

function createFixture(): { manifestPath: string; root: string } {
  const parent = mkdtempSync(path.join(tmpdir(), "support-autopilot-manifest-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "runtime");
  const manifestPath = path.join(parent, "state", "runtime-manifest.json");
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  mkdirSync(path.join(root, "dist", "nested"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "skills", "sdelka-support-autopilot"), { recursive: true });
  writeFileSync(path.join(root, "dist", "index.js"), "export {};\n", "utf8");
  writeFileSync(path.join(root, "dist", "nested", "worker.js"), "export const worker = 1;\n", "utf8");
  writeFileSync(
    path.join(root, "scripts", "start-support-autopilot-shadow-runner.ps1"),
    "Write-Output 'start'\r\n",
    "utf8",
  );
  writeFileSync(path.join(root, "scripts", "unrelated.ps1"), "Write-Output 'ignored'\r\n", "utf8");
  writeFileSync(path.join(root, "skills", "sdelka-support-autopilot", "SKILL.md"), "# Skill\n", "utf8");
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  writeFileSync(path.join(root, "auth.json"), '{"ignored":"secret"}\n', "utf8");
  mkdirSync(path.join(root, "state"), { recursive: true });
  writeFileSync(path.join(root, "state", "runner.log"), "ignored customer data\n", "utf8");
  return { manifestPath, root };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("support autopilot runtime manifest", () => {
  it("creates a deterministic sorted manifest over the exact runtime inputs", () => {
    const { root } = createFixture();

    const first = createSupportAutopilotRuntimeManifest(root, revision);
    const second = createSupportAutopilotRuntimeManifest(root, revision);

    expect(first).toEqual(second);
    expect(first).toEqual({
      files: [
        { path: "dist/index.js", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: "dist/nested/worker.js", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: "package.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: "pnpm-lock.yaml", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: "scripts/start-support-autopilot-shadow-runner.ps1", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: "skills/sdelka-support-autopilot/SKILL.md", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
      revision,
      schema: RUNTIME_MANIFEST_SCHEMA,
    });
  });

  it("verifies an unchanged runtime and rejects a different revision", () => {
    const { root } = createFixture();
    const manifest = createSupportAutopilotRuntimeManifest(root, revision);

    expect(() => verifySupportAutopilotRuntimeManifest(root, manifest, revision)).not.toThrow();
    expect(() => verifySupportAutopilotRuntimeManifest(root, manifest, otherRevision))
      .toThrow("RUNTIME_REVISION_MISMATCH");
  });

  it("rejects a changed runtime file", () => {
    const { root } = createFixture();
    const manifest = createSupportAutopilotRuntimeManifest(root, revision);
    writeFileSync(path.join(root, "dist", "index.js"), "export const changed = true;\n", "utf8");

    expect(() => verifySupportAutopilotRuntimeManifest(root, manifest, revision))
      .toThrow("RUNTIME_FILE_HASH_MISMATCH");
  });

  it("rejects a changed runtime file set", () => {
    const { root } = createFixture();
    const manifest = createSupportAutopilotRuntimeManifest(root, revision);
    writeFileSync(path.join(root, "dist", "unexpected.js"), "export {};\n", "utf8");

    expect(() => verifySupportAutopilotRuntimeManifest(root, manifest, revision))
      .toThrow("RUNTIME_FILE_SET_MISMATCH");
  });

  it("rejects symlinks and junctions inside the runtime inputs", () => {
    const { root } = createFixture();
    const external = path.join(path.dirname(root), "external");
    mkdirSync(external);
    writeFileSync(path.join(external, "payload.js"), "export {};\n", "utf8");
    symlinkSync(external, path.join(root, "dist", "linked"), process.platform === "win32" ? "junction" : "dir");

    expect(() => createSupportAutopilotRuntimeManifest(root, revision))
      .toThrow("RUNTIME_MANIFEST_INVALID");
  });

  it.each([
    ["path traversal", (manifest: any) => ({
      ...manifest,
      files: [{ path: "../auth.json", sha256: "0".repeat(64) }, ...manifest.files.slice(1)],
    })],
    ["duplicate paths", (manifest: any) => ({
      ...manifest,
      files: [manifest.files[0], manifest.files[0], ...manifest.files.slice(1)],
    })],
    ["unknown top-level keys", (manifest: any) => ({ ...manifest, credential: "secret" })],
    ["unknown file keys", (manifest: any) => ({
      ...manifest,
      files: [{ ...manifest.files[0], absolutePath: "C:\\secret" }, ...manifest.files.slice(1)],
    })],
  ])("rejects invalid manifests: %s", (_label, mutate) => {
    const { root } = createFixture();
    const manifest = mutate(createSupportAutopilotRuntimeManifest(root, revision));

    expect(() => verifySupportAutopilotRuntimeManifest(root, manifest, revision))
      .toThrow("RUNTIME_MANIFEST_INVALID");
  });

  it("supports only bounded create and verify commands with redacted results", () => {
    const { manifestPath, root } = createFixture();

    expect(runSupportAutopilotRuntimeManifestCommand([
      "create",
      "--root", root,
      "--revision", revision,
      "--output", manifestPath,
    ])).toEqual({ fileCount: 6, outcome: "created", revision });
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(
      createSupportAutopilotRuntimeManifest(root, revision),
    );
    expect(runSupportAutopilotRuntimeManifestCommand([
      "verify",
      "--root", root,
      "--revision", revision,
      "--manifest", manifestPath,
    ])).toEqual({ fileCount: 6, outcome: "verified", revision });
  });

  it("rejects relative paths, unknown options, and malformed revisions", () => {
    const { manifestPath, root } = createFixture();

    for (const args of [
      ["create", "--root", ".", "--revision", revision, "--output", manifestPath],
      ["create", "--root", root, "--revision", "main", "--output", manifestPath],
      ["create", "--root", root, "--revision", revision, "--output", manifestPath, "--extra", "x"],
      ["verify", "--root", root, "--revision", revision, "--manifest", "relative.json"],
    ]) {
      expect(() => runSupportAutopilotRuntimeManifestCommand(args)).toThrow(
        "SUPPORT_AUTOPILOT_RUNTIME_MANIFEST_FAILED",
      );
    }
  });
});
