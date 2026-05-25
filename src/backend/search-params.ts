export type QueryValue = boolean | number | string | undefined;

export function toSearchParams(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  return params.toString();
}
