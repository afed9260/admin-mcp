import { BackendError } from "./backend-error.js";

type FetchLike = typeof fetch;

export type AdminApiClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: FetchLike;
};

export class AdminApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AdminApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(path: string): Promise<T> {
    const endpoint = this.normalizeEndpoint(path);
    const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      method: "GET",
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      const message =
        typeof data === "object" && data && "message" in data && data.message
          ? String(data.message)
          : `Backend request failed: ${response.status}`;
      throw new BackendError(message, response.status, endpoint);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new BackendError("Backend returned invalid JSON", response.status, endpoint);
    }
  }

  private normalizeEndpoint(path: string): string {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
      throw new BackendError("Invalid backend endpoint", 0, path);
    }

    if (path.startsWith("//")) {
      const firstSegment = path.slice(2).split(/[/?#]/, 1)[0] ?? "";
      if (this.isHostLike(firstSegment)) {
        throw new BackendError("Invalid backend endpoint", 0, path);
      }
    }

    return `/${path.replace(/^\/+/, "")}`;
  }

  private isHostLike(segment: string): boolean {
    return segment === "localhost" || segment.includes(".") || segment.includes(":");
  }
}
