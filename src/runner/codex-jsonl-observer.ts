import { StringDecoder } from "node:string_decoder";

export interface CodexJsonlSummary {
  failedToolCalls: number;
  successfulDecisionSubmissions: number;
  toolCalls: number;
  totalLines: number;
}

export interface CodexJsonlObserverOptions {
  maxBytes?: number;
  maxLineBytes?: number;
  maxLines?: number;
}

export class CodexJsonlObserver {
  private readonly decoder = new StringDecoder("utf8");
  private readonly maximumBytes: number;
  private readonly maximumLineBytes: number;
  private readonly maximumLines: number;
  private buffer = "";
  private byteCount = 0;
  private finished = false;
  private summary: CodexJsonlSummary = {
    failedToolCalls: 0,
    successfulDecisionSubmissions: 0,
    toolCalls: 0,
    totalLines: 0,
  };

  constructor(options: CodexJsonlObserverOptions = {}) {
    this.maximumBytes = options.maxBytes ?? 1024 * 1024;
    this.maximumLineBytes = options.maxLineBytes ?? 64 * 1024;
    this.maximumLines = options.maxLines ?? 1_000;
  }

  push(chunk: Buffer): void {
    this.guard(() => {
      if (this.finished || !Buffer.isBuffer(chunk)) {
        throw new Error("invalid state");
      }
      this.byteCount += chunk.length;
      if (this.byteCount > this.maximumBytes) {
        throw new Error("output limit");
      }
      this.buffer += this.decoder.write(chunk);
      this.drain(false);
    });
  }

  finish(): CodexJsonlSummary {
    return this.guard(() => {
      if (this.finished) {
        throw new Error("already finished");
      }
      this.finished = true;
      this.buffer += this.decoder.end();
      this.drain(true);
      return { ...this.summary };
    });
  }

  private drain(final: boolean): void {
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.consume(line);
    }
    if (Buffer.byteLength(this.buffer, "utf8") > this.maximumLineBytes) {
      throw new Error("line limit");
    }
    if (final && this.buffer.length > 0) {
      const line = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      this.consume(line);
    }
  }

  private consume(line: string): void {
    if (line.length === 0) {
      return;
    }
    if (
      Buffer.byteLength(line, "utf8") > this.maximumLineBytes
      || this.summary.totalLines >= this.maximumLines
    ) {
      throw new Error("line limit");
    }
    const event: unknown = JSON.parse(line);
    if (!this.isRecord(event)) {
      throw new Error("invalid event");
    }
    this.summary.totalLines += 1;
    if (
      event.type !== "item.completed"
      || !this.isRecord(event.item)
      || event.item.type !== "mcp_tool_call"
    ) {
      return;
    }
    const item = event.item;
    this.summary.toolCalls += 1;
    const successful = event.type === "item.completed"
      && item.status === "completed"
      && (item.error === null || item.error === undefined);
    if (!successful) {
      this.summary.failedToolCalls += 1;
      return;
    }
    if (
      item.server === "support-autopilot"
      && item.tool === "submit_support_automation_decision"
    ) {
      this.summary.successfulDecisionSubmissions += 1;
    }
  }

  private guard<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw new Error("CODEX_JSONL_INVALID");
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
