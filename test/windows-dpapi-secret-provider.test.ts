import { describe, expect, it, vi } from "vitest";
import { WindowsDpapiSecretProvider } from "../src/runner/windows-dpapi-secret-provider.js";

describe("WindowsDpapiSecretProvider", () => {
  it("uses a fixed non-interactive PowerShell invocation and returns plaintext only in memory", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "service-secret\r\n" });
    const provider = new WindowsDpapiSecretProvider(execute);

    await expect(provider.read("C:\\ServiceSecrets\\token.dpapi")).resolves.toBe("service-secret");
    expect(execute).toHaveBeenCalledOnce();
    const [file, args, options] = execute.mock.calls[0];
    expect(file).toBe("powershell.exe");
    expect(args.slice(0, 2)).toEqual(["-NoProfile", "-NonInteractive"]);
    expect(args.join(" ")).not.toContain("service-secret");
    expect(options.env).toEqual(expect.objectContaining({
      SUPPORT_AUTOPILOT_DPAPI_BLOB_PATH: "C:\\ServiceSecrets\\token.dpapi",
    }));
  });

  it.each([
    ["execution failure", vi.fn().mockRejectedValue(new Error("raw secret failed"))],
    ["empty output", vi.fn().mockResolvedValue({ stdout: "\r\n" })],
    ["multiline output", vi.fn().mockResolvedValue({ stdout: "secret\r\nother\r\n" })],
    ["oversized output", vi.fn().mockResolvedValue({ stdout: `${"a".repeat(4097)}\r\n` })],
  ])("redacts %s", async (_name, execute) => {
    const provider = new WindowsDpapiSecretProvider(execute);
    await expect(provider.read("C:\\ServiceSecrets\\token.dpapi"))
      .rejects.toThrow("SUPPORT_AUTOPILOT_CREDENTIAL_UNAVAILABLE");
  });
});
