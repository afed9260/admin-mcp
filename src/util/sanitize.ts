const secretKeyPattern = /(token|authorization|cookie|password|secret)/i;

export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : sanitizeForLog(innerValue),
      ]),
    );
  }

  return value;
}
