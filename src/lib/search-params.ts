/** First value of a search param as a trimmed string, or undefined. */
export function param(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const t = v?.trim();
  return t ? t.slice(0, 200) : undefined;
}

/** Only pass through a value from an allow-list. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}
