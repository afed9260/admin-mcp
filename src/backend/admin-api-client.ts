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
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      method: "GET",
    });

    const data = (await response.json().catch(() => ({}))) as T | { message?: string };

    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data && data.message
          ? String(data.message)
          : `Backend request failed: ${response.status}`;
      throw new BackendError(message, response.status, path);
    }

    return data as T;
  }
}
