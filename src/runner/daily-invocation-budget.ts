import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type BudgetState = { date: string; invocationCount: number };

const queues = new Map<string, Promise<void>>();

export class DailyInvocationBudget {
  constructor(
    private readonly statePath: string,
    private readonly maximum: number,
  ) {
    if (!path.isAbsolute(statePath) || !Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error("SUPPORT_AUTOPILOT_BUDGET_UNAVAILABLE");
    }
  }

  reserve(now = new Date()): Promise<boolean> {
    return this.serialize(async () => {
      let releaseFileLock: (() => Promise<void>) | undefined;
      try {
        await mkdir(path.dirname(this.statePath), { recursive: true });
        releaseFileLock = await this.acquireFileLock();
        const date = this.moscowDate(now);
        const current = await this.readState();
        const invocationCount = current?.date === date ? current.invocationCount : 0;
        if (invocationCount >= this.maximum) {
          return false;
        }
        await this.writeState({ date, invocationCount: invocationCount + 1 });
        return true;
      } catch {
        throw new Error("SUPPORT_AUTOPILOT_BUDGET_UNAVAILABLE");
      } finally {
        if (releaseFileLock) {
          await releaseFileLock().catch(() => undefined);
        }
      }
    });
  }

  private async readState(): Promise<BudgetState | null> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "date,invocationCount"
      || typeof (value as Record<string, unknown>).date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test((value as Record<string, unknown>).date as string)
      || !Number.isSafeInteger((value as Record<string, unknown>).invocationCount)
      || Number((value as Record<string, unknown>).invocationCount) < 0
    ) {
      throw new Error("invalid budget state");
    }
    return value as BudgetState;
  }

  private async writeState(state: BudgetState): Promise<void> {
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
    const lockPath = `${this.statePath}.lock`;
    const deadline = Date.now() + 2_000;
    while (true) {
      try {
        const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        return async () => {
          await handle.close();
          await unlink(lockPath);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private moscowDate(now: Date): string {
    if (Number.isNaN(now.getTime())) {
      throw new Error("invalid date");
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/Moscow",
      year: "numeric",
    }).formatToParts(now);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.statePath).toLowerCase();
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    queues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(key) === queued) {
        queues.delete(key);
      }
    }
  }
}
