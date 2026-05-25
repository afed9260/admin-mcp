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
