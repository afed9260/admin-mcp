import { spawn } from "node:child_process";

export interface CodexProcessInput {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  executablePath: string;
  maxOutputBytes?: number;
  stdin?: string;
  timeoutMs: number;
}

export interface CodexProcessResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface CodexProcessRunner {
  run(input: CodexProcessInput): Promise<CodexProcessResult>;
}

export function readSingleCodexCommandOutput(result: CodexProcessResult): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if ((stdout && stderr) || (!stdout && !stderr)) {
    throw new Error("CODEX_COMMAND_OUTPUT_INVALID");
  }
  return stdout || stderr;
}

export class SpawnCodexProcessRunner implements CodexProcessRunner {
  run(input: CodexProcessInput): Promise<CodexProcessResult> {
    return new Promise((resolve, reject) => {
      const maximum = input.maxOutputBytes ?? 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let outputExceeded = false;
      const child = spawn(input.executablePath, input.args, {
        cwd: input.cwd,
        env: input.environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        timedOut = true;
        this.terminateTree(child);
      }, input.timeoutMs);

      const capture = (target: "stdout" | "stderr", chunk: Buffer): void => {
        outputBytes += chunk.length;
        if (outputBytes > maximum) {
          outputExceeded = true;
          this.terminateTree(child);
          return;
        }
        if (target === "stdout") {
          stdout += chunk.toString("utf8");
        } else {
          stderr += chunk.toString("utf8");
        }
      };
      child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        if (outputExceeded) {
          reject(new Error("CODEX_PROCESS_OUTPUT_LIMIT"));
          return;
        }
        resolve({ exitCode, stderr, stdout, timedOut });
      });
      child.stdin.end(input.stdin ?? "");
    });
  }

  private terminateTree(child: ReturnType<typeof spawn>): void {
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      const fallback = setTimeout(() => child.kill("SIGKILL"), 1_000);
      fallback.unref();
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the timeout and termination.
    }
  }
}
