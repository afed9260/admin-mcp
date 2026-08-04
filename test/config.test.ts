import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads required env values", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "token",
      AUDIT_LOG_PATH: "./audit/test.jsonl",
    });

    expect(config.adminApiBaseUrl).toBe("https://malikbot.ru/new-admin");
    expect(config.adminApiToken).toBe("token");
    expect(config.auditLogPath).toBe("./audit/test.jsonl");
    expect(config.profile).toBe("admin");
  });

  it("uses ADMIN_MCP_TOKEN as a local Codex token alias", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_MCP_TOKEN: "token-from-codex-env",
    });

    expect(config.adminApiToken).toBe("token-from-codex-env");
  });

  it("keeps write tools disabled unless explicitly enabled", () => {
    expect(
      loadConfig({
        ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
        ADMIN_API_TOKEN: "token",
      }).enableWriteTools,
    ).toBe(false);

    expect(
      loadConfig({
        ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
        ADMIN_API_TOKEN: "token",
        ADMIN_MCP_ENABLE_WRITE: "true",
      }).enableWriteTools,
    ).toBe(true);
  });

  it("loads the readonly profile with the general admin credential", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "readonly-token",
      ADMIN_MCP_PROFILE: "readonly",
    });

    expect(config.profile).toBe("readonly");
    expect(config.adminApiToken).toBe("readonly-token");
    expect(config.enableWriteTools).toBe(false);
  });

  it("loads the support autopilot profile only from its dedicated credential", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "owner-token-must-not-be-used",
      ADMIN_MCP_PROFILE: "support_autopilot",
      SUPPORT_AUTOPILOT_SERVICE_TOKEN: "support-token",
    });

    expect(config.profile).toBe("support_autopilot");
    expect(config.adminApiToken).toBe("support-token");
    expect(config.enableWriteTools).toBe(false);
  });

  it("does not fall back to general tokens for the support autopilot profile", () => {
    expect(() => loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "owner-token",
      ADMIN_MCP_TOKEN: "general-mcp-token",
      ADMIN_MCP_PROFILE: "support_autopilot",
    })).toThrow("SUPPORT_AUTOPILOT_SERVICE_TOKEN is required");
  });

  it("rejects general write tools for restricted profiles", () => {
    expect(() => loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "readonly-token",
      ADMIN_MCP_PROFILE: "readonly",
      ADMIN_MCP_ENABLE_WRITE: "true",
    })).toThrow("ADMIN_MCP_ENABLE_WRITE is allowed only for the admin profile");

    expect(() => loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_MCP_PROFILE: "support_autopilot",
      SUPPORT_AUTOPILOT_SERVICE_TOKEN: "support-token",
      ADMIN_MCP_ENABLE_WRITE: "true",
    })).toThrow("ADMIN_MCP_ENABLE_WRITE is allowed only for the admin profile");
  });

  it("rejects unknown MCP profiles", () => {
    expect(() => loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      ADMIN_API_TOKEN: "token",
      ADMIN_MCP_PROFILE: "everything",
    })).toThrow("ADMIN_MCP_PROFILE must be admin, readonly, or support_autopilot");
  });

  it("rejects missing token", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin",
      }),
    ).toThrow("ADMIN_API_TOKEN is required");
  });

  it("normalizes trailing slash from base URL", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin/",
      ADMIN_API_TOKEN: "token",
    });

    expect(config.adminApiBaseUrl).toBe("https://malikbot.ru/new-admin");
  });

  it("trims and returns canonical parsed base URL", () => {
    const config = loadConfig({
      ADMIN_API_BASE_URL: " https://MALIKBOT.RU:443/new-admin/ ",
      ADMIN_API_TOKEN: "token",
    });

    expect(config.adminApiBaseUrl).toBe("https://malikbot.ru/new-admin");
  });

  it("rejects malformed base URL", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "not a url",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow("ADMIN_API_BASE_URL must be a valid URL");
  });

  it("rejects non-https base URL", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "http://malikbot.ru/new-admin",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow("ADMIN_API_BASE_URL must use https");
  });

  it("rejects base URL credentials", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "https://user:pass@malikbot.ru/new-admin",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow("ADMIN_API_BASE_URL must not include credentials");
  });

  it("rejects base URL query strings", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin?token=abc",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow("ADMIN_API_BASE_URL must not include query string");
  });

  it("rejects base URL hashes", () => {
    expect(() =>
      loadConfig({
        ADMIN_API_BASE_URL: "https://malikbot.ru/new-admin#section",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow("ADMIN_API_BASE_URL must not include hash");
  });
});
