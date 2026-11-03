/** Multiple names use JSON in the existing text columns; old names remain valid. */
export function readShootValues(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed;
  } catch { /* A legacy value is a single name, including any commas. */ }
  return [value];
}

export function normalizeShootValues(value: string): string[] {
  const names = readShootValues(value).map(name => name.trim()).filter(Boolean);
  return names.filter((name, index) => names.findIndex(other => other.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')) === index);
}

export function storeShootValues(names: string[]): string {
  return names.length === 0 ? '' : names.length === 1 ? names[0] : JSON.stringify(names);
}
