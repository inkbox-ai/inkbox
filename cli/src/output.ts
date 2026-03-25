function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: string[],
): void {
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }

  const widths = columns.map((col) =>
    Math.max(
      col.length,
      ...rows.map((r) => formatValue(r[col]).length),
    ),
  );

  const header = columns
    .map((col, i) => col.padEnd(widths[i]))
    .join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  console.log(header);
  console.log(separator);
  for (const row of rows) {
    const line = columns
      .map((col, i) => formatValue(row[col]).padEnd(widths[i]))
      .join("  ");
    console.log(line);
  }
}

export function printRecord(obj: Record<string, unknown>): void {
  const maxKey = Math.max(...Object.keys(obj).map((k) => k.length));
  for (const [key, val] of Object.entries(obj)) {
    console.log(`${key.padEnd(maxKey)}  ${formatValue(val)}`);
  }
}

export function printJson(data: unknown): void {
  console.log(
    JSON.stringify(
      data,
      (_key, val) => (val instanceof Date ? val.toISOString() : val),
      2,
    ),
  );
}

export function output(
  data: unknown,
  opts: { json: boolean; columns?: string[] },
): void {
  if (opts.json) {
    printJson(data);
    return;
  }
  if (Array.isArray(data) && opts.columns) {
    printTable(data as Record<string, unknown>[], opts.columns);
  } else if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    printRecord(data as Record<string, unknown>);
  } else {
    console.log(data);
  }
}
