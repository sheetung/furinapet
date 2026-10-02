export function supportsCharacter(minimum: unknown, current: string, schema: unknown): boolean {
  if (schema !== undefined && schema !== 1) return false;
  if (minimum === undefined) return true;
  if (typeof minimum !== 'string' || !/^\d+\.\d+\.\d+$/.test(minimum)) return false;
  const required = minimum.split('.').map(Number);
  if (!required.every(Number.isSafeInteger)) return false;
  const installed = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (required[i] !== installed[i]) return required[i] < installed[i];
  }
  return true;
}
