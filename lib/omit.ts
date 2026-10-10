/** Shallow copy of `value` without the listed keys, preserving the order of the remaining keys. */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = {...value};
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}
