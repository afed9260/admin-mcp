const secretKeys = new Set([
  "accesstoken",
  "accesskey",
  "apikey",
  "auth",
  "authorization",
  "cookie",
  "jwt",
  "password",
  "secret",
  "session",
  "sessionid",
  "token",
]);
const bearerPattern = /\b(?:Authorization\s*:\s*)?Bearer\s+[^\s"',;}\\]+/gi;
const cookieHeaderPattern = /\bCookie\s*:\s*[^"',}\\]+/gi;
const authorizationHeaderPattern = /\b(Authorization\s*:\s*)[^"',;}\\]+/gi;
const secretColonPattern =
  /\b(password|secret|api[_-]?key|access[_-]?key|token|jwt|session[_-]?id|session)\s*:\s*[^\s"',;}\\]+/gi;
const secretQueryParamPattern =
  /(\b(?:access[_-]?token|token|password|secret|authorization|api[_-]?key|apiKey|jwt|sessionId|session_id|access[_-]?key|accessKey)=)[^&#;\s"']+/gi;

function isSecretKey(key: string): boolean {
  const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
  return (
    secretKeys.has(normalizedKey) ||
    normalizedKey.endsWith("token") ||
    normalizedKey.endsWith("password") ||
    normalizedKey.endsWith("secret") ||
    normalizedKey.endsWith("cookie")
  );
}

export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }

  if (typeof value === "string") {
    return value
      .replace(cookieHeaderPattern, "Cookie: [REDACTED]")
      .replace(authorizationHeaderPattern, "$1[REDACTED]")
      .replace(bearerPattern, (match) =>
        match.toLowerCase().startsWith("authorization") ? "Authorization: Bearer [REDACTED]" : "Bearer [REDACTED]",
      )
      .replace(secretColonPattern, "$1: [REDACTED]")
      .replace(secretQueryParamPattern, "$1[REDACTED]");
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        isSecretKey(key) ? "[REDACTED]" : sanitizeForLog(innerValue),
      ]),
    );
  }

  return value;
}
