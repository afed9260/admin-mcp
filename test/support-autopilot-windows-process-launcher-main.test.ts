import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runSupportAutopilotWindowsProcessLauncherCommand,
} from "../src/runner/support-autopilot-windows-process-launcher-main.js";

const validArgs = [
  "launch",
  "--node-executable", "C:\\tools\\node.exe",
  "--entry-point", "C:\\support-autopilot\\admin-mcp\\dist\\runner.js",
  "--working-directory", "C:\\support-autopilot\\admin-mcp",
  "--stdin-path", "C:\\support-autopilot\\state\\runner.stdin",
  "--stdout-path", "C:\\support-autopilot\\state\\runner.stdout.log",
  "--stderr-path", "C:\\support-autopilot\\state\\runner.stderr.log",
];

describe("support autopilot Windows process launcher", () => {
  it("launches one detached process and returns only its PID", () => {
    const launch = vi.fn().mockReturnValue(4242);

    expect(runSupportAutopilotWindowsProcessLauncherCommand(validArgs, {
      launch,
      pathExists: () => true,
    })).toEqual({ processId: 4242, started: true });
    expect(launch).toHaveBeenCalledWith({
      entryPoint: "C:\\support-autopilot\\admin-mcp\\dist\\runner.js",
      nodeExecutable: "C:\\tools\\node.exe",
      stderrPath: "C:\\support-autopilot\\state\\runner.stderr.log",
      stdinPath: "C:\\support-autopilot\\state\\runner.stdin",
      stdoutPath: "C:\\support-autopilot\\state\\runner.stdout.log",
      workingDirectory: "C:\\support-autopilot\\admin-mcp",
    });
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("detaches a real process from the launching Node process", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "support-autopilot-launcher-"));
    const entryPoint = path.join(root, "runner.cjs");
    const stdinPath = path.join(root, "runner.stdin");
    const stdoutPath = path.join(root, "runner.stdout.log");
    const stderrPath = path.join(root, "runner.stderr.log");
    const stopPath = path.join(root, "runner.stop");
    let processId = 0;
    const waitForExit = async (timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      do {
        try {
          process.kill(processId, 0);
        } catch {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      return false;
    };
    try {
      writeFileSync(entryPoint, [
        'const { existsSync } = require("node:fs");',
        `const stopPath = ${JSON.stringify(stopPath)};`,
        "setInterval(() => { if (existsSync(stopPath)) process.exit(0); }, 25);",
      ].join("\n"), "utf8");
      for (const streamPath of [stdinPath, stdoutPath, stderrPath]) {
        writeFileSync(streamPath, "", "utf8");
      }

      const result = runSupportAutopilotWindowsProcessLauncherCommand([
        "launch",
        "--node-executable", process.execPath,
        "--entry-point", entryPoint,
        "--working-directory", tmpdir(),
        "--stdin-path", stdinPath,
        "--stdout-path", stdoutPath,
        "--stderr-path", stderrPath,
      ]);
      processId = result.processId;
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(() => process.kill(processId, 0)).not.toThrow();
    } finally {
      let stopped = true;
      if (processId > 0) {
        writeFileSync(stopPath, "", "utf8");
        stopped = await waitForExit(5_000);
        if (!stopped) {
          try { process.kill(processId); } catch {}
          stopped = await waitForExit(5_000);
        }
      }
      if (stopped) {
        rmSync(root, { force: true, maxRetries: 100, recursive: true, retryDelay: 100 });
      }
      expect(stopped, `detached process ${processId} did not exit`).toBe(true);
    }
  });

  it("fails closed for invalid paths, duplicate streams, or unknown options", () => {
    for (const args of [
      validArgs.map((value) => value === "C:\\tools\\node.exe" ? "node.exe" : value),
      validArgs.map((value) => value === "C:\\support-autopilot\\state\\runner.stderr.log"
        ? "C:\\support-autopilot\\state\\runner.stdout.log"
        : value),
      [...validArgs, "--unexpected", "value"],
    ]) {
      expect(() => runSupportAutopilotWindowsProcessLauncherCommand(args, {
        launch: vi.fn(),
        pathExists: () => true,
      })).toThrow();
    }

    expect(() => runSupportAutopilotWindowsProcessLauncherCommand(validArgs, {
      launch: vi.fn(),
      pathExists: () => false,
    })).toThrow();
  });
});
