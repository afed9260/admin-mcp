import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DailyInvocationBudget } from "../src/runner/daily-invocation-budget.js";

describe("DailyInvocationBudget", () => {
  let root: string;
  let statePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "support-shadow-budget-"));
    statePath = path.join(root, "budget.json");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("persists reservations across instances and enforces the maximum", async () => {
    const now = new Date("2026-08-04T09:00:00.000Z");
    expect(await new DailyInvocationBudget(statePath, 2).reserve(now)).toBe(true);
    expect(await new DailyInvocationBudget(statePath, 2).reserve(now)).toBe(true);
    expect(await new DailyInvocationBudget(statePath, 2).reserve(now)).toBe(false);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      date: "2026-08-04",
      invocationCount: 2,
    });
  });

  it("rolls over on the canonical Moscow date", async () => {
    await writeFile(statePath, JSON.stringify({ date: "2026-08-04", invocationCount: 10 }));
    expect(await new DailyInvocationBudget(statePath, 10).reserve(
      new Date("2026-08-04T21:30:00.000Z"),
    )).toBe(true);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      date: "2026-08-05",
      invocationCount: 1,
    });
  });

  it("fails closed for malformed durable state", async () => {
    await writeFile(statePath, JSON.stringify({ date: "2026-08-04", invocationCount: 1, token: "secret" }));
    let failure: unknown;
    try {
      await new DailyInvocationBudget(statePath, 10).reserve(new Date("2026-08-04T09:00:00Z"));
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toBe("SUPPORT_AUTOPILOT_BUDGET_UNAVAILABLE");
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("serializes concurrent reservations across instances", async () => {
    const now = new Date("2026-08-04T09:00:00.000Z");
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      new DailyInvocationBudget(statePath, 3).reserve(now)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      date: "2026-08-04",
      invocationCount: 3,
    });
  });

  it("releases one same-day reservation without decrementing a rolled-over date", async () => {
    const budget = new DailyInvocationBudget(statePath, 2);
    const firstDay = new Date("2026-08-04T09:00:00.000Z");
    const nextDay = new Date("2026-08-04T21:30:00.000Z");

    expect(await budget.reserve(firstDay)).toBe(true);
    await budget.release(firstDay);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      date: "2026-08-04",
      invocationCount: 0,
    });

    expect(await budget.reserve(nextDay)).toBe(true);
    await budget.release(firstDay);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      date: "2026-08-05",
      invocationCount: 1,
    });
  });
});
