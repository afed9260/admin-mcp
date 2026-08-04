import { AdminApiClient, AdminApiClientOptions } from "./admin-api-client.js";
import { BackendError } from "./backend-error.js";

export class SupportAutopilotApiClient extends AdminApiClient {
  constructor(options: AdminApiClientOptions) {
    super(options);
  }

  override async get<T>(path: string): Promise<T> {
    this.assertAllowedPath(path);
    return super.get<T>(path);
  }

  override async post<T>(path: string, body: unknown): Promise<T> {
    this.assertAllowedPath(path);
    return super.post<T>(path, body);
  }

  override async put<T>(path: string, body: unknown): Promise<T> {
    this.assertAllowedPath(path);
    return super.put<T>(path, body);
  }

  override async postForm<T>(path: string, body: FormData): Promise<T> {
    this.assertAllowedPath(path);
    return super.postForm<T>(path, body);
  }

  private assertAllowedPath(path: string): void {
    let decodedPath = path.split(/[?#]/, 1)[0] ?? "";
    try {
      for (let depth = 0; depth < 4; depth += 1) {
        const next = decodeURIComponent(decodedPath);
        if (next === decodedPath) {
          break;
        }
        decodedPath = next;
      }
    } catch {
      throw this.outsideNamespace(path);
    }

    const segments = decodedPath.split("/");
    if (
      !(decodedPath === "/support-automation" || decodedPath.startsWith("/support-automation/"))
      || segments.some((segment) => segment === "." || segment === "..")
      || /%[a-f0-9]{2}/i.test(decodedPath)
      || decodedPath.includes("\\")
      || decodedPath.includes("\0")
    ) {
      throw this.outsideNamespace(path);
    }
  }

  private outsideNamespace(path: string): BackendError {
    return new BackendError(
      "Support autopilot endpoint is outside the allowed namespace",
      0,
      path,
    );
  }
}
