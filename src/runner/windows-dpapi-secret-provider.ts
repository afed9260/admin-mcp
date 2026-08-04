import { execFile } from "node:child_process";
import { promisify } from "node:util";

type ExecuteFile = (
  file: string,
  args: string[],
  options: { encoding: "utf8"; env: NodeJS.ProcessEnv; timeout: number; windowsHide: true },
) => Promise<{ stdout: string }>;

const executeFile = promisify(execFile) as ExecuteFile;
const DPAPI_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$secure=Get-Content -LiteralPath $env:SUPPORT_AUTOPILOT_DPAPI_BLOB_PATH -Raw | ConvertTo-SecureString",
  "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
  "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))}",
  "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}",
].join(";");

export class WindowsDpapiSecretProvider {
  constructor(private readonly execute: ExecuteFile = executeFile) {}

  async read(blobPath: string): Promise<string> {
    try {
      const result = await this.execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT],
        {
          encoding: "utf8",
          env: {
            ComSpec: process.env.ComSpec,
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            SUPPORT_AUTOPILOT_DPAPI_BLOB_PATH: blobPath,
            WINDIR: process.env.WINDIR,
          },
          timeout: 15_000,
          windowsHide: true,
        },
      );
      const secret = result.stdout.replace(/\r?\n$/, "");
      if (
        secret.length < 8
        || secret.length > 4_096
        || secret !== secret.trim()
        || /[\r\n\0]/.test(secret)
      ) {
        throw new Error("invalid secret");
      }
      return secret;
    } catch {
      throw new Error("SUPPORT_AUTOPILOT_CREDENTIAL_UNAVAILABLE");
    }
  }
}
