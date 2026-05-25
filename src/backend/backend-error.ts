export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
