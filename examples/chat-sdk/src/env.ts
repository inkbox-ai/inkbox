export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the example.`);
  return value;
}
