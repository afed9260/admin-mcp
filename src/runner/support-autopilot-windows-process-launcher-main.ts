import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface LaunchOptions {
  entryPoint: string;
  nodeExecutable: string;
  stderrPath: string;
  stdinPath: string;
  stdoutPath: string;
  workingDirectory: string;
}

export interface WindowsProcessLauncherDependencies {
  launch?: (options: LaunchOptions) => number;
  pathExists?: (filePath: string) => boolean;
}

export function runSupportAutopilotWindowsProcessLauncherCommand(
  args: readonly string[],
  dependencies: WindowsProcessLauncherDependencies = {},
): { processId: number; started: true } {
  const [command, ...optionArgs] = args;
  if (command !== "launch") throw new Error("invalid command");
  const options = parseOptions(optionArgs);
  const launchOptions = {
    entryPoint: windowsAbsolutePath(requiredOption(options, "entry-point")),
    nodeExecutable: windowsAbsolutePath(requiredOption(options, "node-executable")),
    stderrPath: windowsAbsolutePath(requiredOption(options, "stderr-path")),
    stdinPath: windowsAbsolutePath(requiredOption(options, "stdin-path")),
    stdoutPath: windowsAbsolutePath(requiredOption(options, "stdout-path")),
    workingDirectory: windowsAbsolutePath(requiredOption(options, "working-directory")),
  };
  const streamPaths = [
    launchOptions.stdinPath,
    launchOptions.stdoutPath,
    launchOptions.stderrPath,
  ].map((value) => value.toLowerCase());
  if (new Set(streamPaths).size !== streamPaths.length) {
    throw new Error("stream paths must be distinct");
  }
  const pathExists = dependencies.pathExists ?? existsSync;
  if (Object.values(launchOptions).some((value) => !pathExists(value))) {
    throw new Error("launcher path missing");
  }
  const processId = (dependencies.launch ?? launchDetachedProcess)(launchOptions);
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error("invalid launched process id");
  }
  return { processId, started: true };
}

function launchDetachedProcess(options: LaunchOptions): number {
  const stdinFd = openSync(options.stdinPath, "r");
  const stdoutFd = openSync(options.stdoutPath, "a");
  const stderrFd = openSync(options.stderrPath, "a");
  try {
    const child = spawn(options.nodeExecutable, [options.entryPoint], {
      cwd: options.workingDirectory,
      detached: true,
      env: process.env,
      stdio: [stdinFd, stdoutFd, stderrFd],
      windowsHide: true,
    });
    if (child.pid === undefined) {
      throw new Error("process launch failed");
    }
    child.unref();
    return child.pid;
  } finally {
    closeSync(stderrFd);
    closeSync(stdoutFd);
    closeSync(stdinFd);
  }
}

function parseOptions(args: readonly string[]): Map<string, string> {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error("invalid options");
  }
  const allowed = new Set([
    "entry-point",
    "node-executable",
    "stderr-path",
    "stdin-path",
    "stdout-path",
    "working-directory",
  ]);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      key === undefined
      || value === undefined
      || !/^--[a-z][a-z-]*$/.test(key)
      || !allowed.has(key.slice(2))
      || options.has(key.slice(2))
      || value.length === 0
    ) {
      throw new Error("invalid options");
    }
    options.set(key.slice(2), value);
  }
  if (options.size !== allowed.size) throw new Error("missing options");
  return options;
}

function requiredOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined) throw new Error("missing option");
  return value;
}

function windowsAbsolutePath(value: string): string {
  if (!path.win32.isAbsolute(value) || value.includes("\0")) {
    throw new Error("invalid path");
  }
  return path.win32.normalize(value);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const result = runSupportAutopilotWindowsProcessLauncherCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("SUPPORT_AUTOPILOT_WINDOWS_PROCESS_LAUNCHER_FAILED\n");
    process.exitCode = 1;
  }
}
