import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { WindowsDpapiSecretProvider } from "./windows-dpapi-secret-provider.js";
import { parseSupportAutopilotToolScope } from "../tools/support-autopilot-tools.js";

type Environment = Record<string, string | undefined>;
type Spawn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; shell: false; stdio: "inherit"; windowsHide: true },
) => ChildProcess;

export interface SupportAutopilotMcpLauncherDependencies {
  mcpServerEntryPath?: string;
  nodeExecutablePath?: string;
  secretProvider?: Pick<WindowsDpapiSecretProvider, "read">;
  spawn?: Spawn;
}

export async function launchSupportAutopilotMcp(
  environment: Environment = process.env,
  dependencies: SupportAutopilotMcpLauncherDependencies = {},
): Promise<number> {
  try {
    if (environment.SUPPORT_AUTOPILOT_SERVICE_TOKEN !== undefined) {
      throw new Error("plaintext token");
    }
    const adminApiBaseUrl = validatedBaseUrl(environment.ADMIN_API_BASE_URL);
    const credentialBlobPath = absoluteWindowsPath(
      environment.SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH,
    );
    const workKind = parseSupportAutopilotToolScope(
      environment.SUPPORT_AUTOPILOT_WORK_KIND,
    );
    const secretProvider = dependencies.secretProvider ?? new WindowsDpapiSecretProvider();
    const token = await secretProvider.read(credentialBlobPath);
    const spawn = dependencies.spawn ?? nodeSpawn;
    const nodeExecutablePath = dependencies.nodeExecutablePath ?? process.execPath;
    const mcpServerEntryPath = dependencies.mcpServerEntryPath
      ?? fileURLToPath(new URL("../index.js", import.meta.url));
    const child = spawn(nodeExecutablePath, [mcpServerEntryPath], {
      env: {
        ADMIN_API_BASE_URL: adminApiBaseUrl,
        ADMIN_MCP_ENABLE_WRITE: "false",
        ADMIN_MCP_PROFILE: "support_autopilot",
        APPDATA: environment.APPDATA,
        ComSpec: environment.ComSpec,
        LOCALAPPDATA: environment.LOCALAPPDATA,
        PATH: environment.PATH,
        PATHEXT: environment.PATHEXT,
        SUPPORT_AUTOPILOT_SERVICE_TOKEN: token,
        SUPPORT_AUTOPILOT_WORK_KIND: workKind,
        SystemRoot: environment.SystemRoot,
        TEMP: environment.TEMP,
        TMP: environment.TMP,
        USERPROFILE: environment.USERPROFILE,
        WINDIR: environment.WINDIR,
      },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } catch {
    throw new Error("SUPPORT_AUTOPILOT_MCP_LAUNCH_FAILED");
  }
}

function validatedBaseUrl(raw: string | undefined): string {
  if (!raw || raw !== raw.trim()) {
    throw new Error("missing url");
  }
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("invalid url");
  }
  return parsed.href.replace(/\/$/, "");
}

function absoluteWindowsPath(raw: string | undefined): string {
  if (!raw || raw !== raw.trim() || !path.win32.isAbsolute(raw) || raw.includes("\0")) {
    throw new Error("invalid path");
  }
  return path.win32.normalize(raw);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    process.exitCode = await launchSupportAutopilotMcp();
  } catch {
    process.exitCode = 1;
  }
}
