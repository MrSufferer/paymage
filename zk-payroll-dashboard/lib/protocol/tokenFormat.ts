const STROOPS_PER_XLM = 10_000_000;

export function formatXlm(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  })} XLM`;
}

export function formatStroopsAsXlm(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${(numeric / STROOPS_PER_XLM).toLocaleString(undefined, {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  })} XLM`;
}
