const secretKeyPattern =
  /(token|authorization|auth|cookie|password|secret|api[_-]?key|access[_-]?key|jwt|session(?:[_-]?id)?)/i;
const authorizationBearerPattern = /\bAuthorization\s*:\s*Bearer\s+[^\s"',}\\]+/gi;
const secretQueryParamPattern =
  /(\b(?:access_token|token|api_key|apiKey|jwt|sessionId|session_id|access_key|accessKey)=)[^&#\s"']+/gi;

export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }

  if (typeof value === "string") {
    return value
      .replace(authorizationBearerPattern, "Authorization: Bearer [REDACTED]")
      .replace(secretQueryParamPattern, "$1[REDACTED]");
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
