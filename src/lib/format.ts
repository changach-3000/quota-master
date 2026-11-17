// Display helpers. Money arrives as integer cents (number or bigint) and is
// only turned into text here, at the edge.

const KSH = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const KSH_CENTS = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1250000n -> "KSh 12,500". Shows cents only when there are any. */
export function formatKsh(cents: number | bigint, opts: { signed?: boolean } = {}): string {
  const value = Number(cents);
  const abs = Math.abs(value);
  const body = abs % 100 === 0 ? KSH.format(abs / 100) : KSH_CENTS.format(abs / 100);
  const sign = value < 0 ? "−" : opts.signed && value > 0 ? "+" : "";
  return `${sign}KSh ${body}`;
}

/** Compact axis label: 340000_00 -> "340k", 3_900_000_00 -> "3.9M". */
export function formatKshCompact(cents: number): string {
  const shillings = cents / 100;
  if (Math.abs(shillings) >= 1_000_000) return `${+(shillings / 1_000_000).toFixed(1)}M`;
  if (Math.abs(shillings) >= 1_000) return `${Math.round(shillings / 1_000)}k`;
  return String(Math.round(shillings));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date "2026-03-12" -> "12 Mar 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthLabel(index: number): string {
  return MONTHS[index % 12];
}

/** (2904, 2658) -> "+9.3%". Null when there is no baseline. */
export function formatChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** How a payment's reference reads in tables. Historical imports may have none. */
export function referenceLabel(method: "mpesa" | "cash" | null, reference: string, isReversal = false): string {
  if (isReversal) return reference;
  if (!reference) return "From paper record";
  return method === "cash" ? `Receipt ${reference}` : reference;
}
