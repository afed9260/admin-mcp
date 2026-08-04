import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { launchSupportAutopilotMcp } from "../src/runner/support-autopilot-mcp-launcher.js";

describe("launchSupportAutopilotMcp", () => {
  it("decrypts in memory and starts the MCP child with an allowlisted environment", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child as never);
    const read = vi.fn().mockResolvedValue("service-secret");
    const launching = launchSupportAutopilotMcp(
      {
        ADMIN_API_BASE_URL: "https://admin.example.test/new-admin",
        PATH: "C:\\Windows\\System32",
        SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\Secrets\\token.dpapi",
        POISON: "must-not-pass",
      },
      {
        mcpServerEntryPath: "C:\\ServiceApp\\dist\\index.js",
        nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
        secretProvider: { read },
        spawn,
      },
    );
    await Promise.resolve();
    child.emit("close", 0);

    await expect(launching).resolves.toBe(0);
    expect(read).toHaveBeenCalledWith("C:\\Secrets\\token.dpapi");
    expect(spawn).toHaveBeenCalledOnce();
    const options = spawn.mock.calls[0][2];
    expect(options.env).toEqual(expect.objectContaining({
      ADMIN_API_BASE_URL: "https://admin.example.test/new-admin",
      ADMIN_MCP_ENABLE_WRITE: "false",
      ADMIN_MCP_PROFILE: "support_autopilot",
      SUPPORT_AUTOPILOT_SERVICE_TOKEN: "service-secret",
    }));
    expect(options.env).not.toHaveProperty("POISON");
  });

  it("rejects a plaintext runner token before decryption or spawn", async () => {
    const spawn = vi.fn();
    const read = vi.fn();
    await expect(launchSupportAutopilotMcp({
      ADMIN_API_BASE_URL: "https://admin.example.test",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\Secrets\\token.dpapi",
      SUPPORT_AUTOPILOT_SERVICE_TOKEN: "forbidden",
    }, {
      mcpServerEntryPath: "C:\\ServiceApp\\dist\\index.js",
      nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
      secretProvider: { read },
      spawn,
    })).rejects.toThrow("SUPPORT_AUTOPILOT_MCP_LAUNCH_FAILED");
    expect(read).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
