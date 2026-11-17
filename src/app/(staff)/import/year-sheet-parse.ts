// Reading the treasurer's yearly sheet in the browser. Pure functions, so the
// same logic is unit-tested. The server re-checks everything it is sent.

export type Cell = string;

export type YearLayout = {
  headerRow: number; // index into the grid
  nameCol: number;
  quotaCol: number | null;
  instalmentCols: number[];
  totalCol: number | null;
  remarksCol: number | null;
  year: number | null; // from a title like "Quota payment for the year 2025"
};

export type ParsedInstalment = { column: number; amountCents: number; method: "mpesa" | "cash"; raw: string };

export type ParsedPerson = {
  line: number; // 1-based row number as the treasurer sees it in Excel
  rawName: string;
  name: string;
  quotaCents: number | null;
  instalments: ParsedInstalment[];
  paidCents: number;
  totalCents: number | null;
  cleared: boolean;
  errors: string[];
  warnings: string[];
};

const norm = (s: Cell | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "20,000" / "20000" / 20000 -> cents, or null when the cell is empty. NaN when unreadable. */
export function parseAmount(cell: Cell): number | null {
  const s = norm(cell).replace(/^ksh\.?\s*/i, "").replace(/,/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/**
 * An instalment cell may hold one or more amounts, each optionally marked
 * "-M" for M-Pesa: "3200-M", "3200 -M", "3200- M", "1000 3200-M".
 * Returns null when the cell has something that isn't an amount.
 */
export function parseInstalmentCell(cell: Cell): { amountCents: number; method: "mpesa" | "cash"; raw: string }[] | null {
  const s = norm(cell).replace(/,/g, "");
  if (!s) return [];
  const token = /(\d+(?:\.\d{1,2})?)\s*(-\s*M\b|\(M\)|\bM\b)?/giy;
  const out: { amountCents: number; method: "mpesa" | "cash"; raw: string }[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " " || s[i] === "+" || s[i] === ";" || s[i] === "/") {
      i++;
      continue;
    }
    token.lastIndex = i;
    const m = token.exec(s);
    if (!m || m[0].length === 0) return null;
    const cents = Math.round(Number(m[1]) * 100);
    if (cents <= 0) return null;
    out.push({ amountCents: cents, method: m[2] ? "mpesa" : "cash", raw: m[0].trim() });
    i = token.lastIndex;
  }
  return out;
}

const KEEP_UPPER = new Set(["CPA", "MP", "MCA", "CEO", "II", "III", "IV"]);
const TITLES: Record<string, string> = { PROF: "Prof.", "PROF.": "Prof.", DR: "Dr.", "DR.": "Dr.", REV: "Rev.", "REV.": "Rev.", FR: "Fr.", "FR.": "Fr.", MR: "Mr.", "MR.": "Mr.", MRS: "Mrs.", "MRS.": "Mrs.", MS: "Ms.", "MS.": "Ms." };

/** "JOHN K. DOE" -> "John K. Doe". Names already in mixed case are left alone. */
export function displayName(raw: string): string {
  const s = norm(raw).replace(/[’`]/g, "'");
  if (/[a-z]/.test(s)) return s;
  return s
    .split(" ")
    .map((w) => {
      if (TITLES[w]) return TITLES[w];
      if (KEEP_UPPER.has(w)) return w;
      if (/^[A-Z]\.?$/.test(w)) return w; // initials
      return w
        .toLowerCase()
        .replace(/(^|[-'])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

/** Find the header row and guess which column is which. The user can adjust it. */
export function detectLayout(grid: Cell[][]): YearLayout | null {
  let year: number | null = null;
  for (const row of grid.slice(0, 5)) {
    const m = row.join(" ").match(/\b(20\d{2})\b/);
    if (m) {
      year = Number(m[1]);
      break;
    }
  }
  const headerRow = grid.findIndex((r) => r.some((c) => /^names?$/i.test(norm(c))));
  if (headerRow < 0) return null;
  // Labels can sit on the header row or the row just under it (merged cells).
  const label = (c: number) => `${norm(grid[headerRow][c])} ${norm(grid[headerRow + 1]?.[c])}`.trim();
  const width = Math.max(...grid.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, c) => c);
  const nameCol = cols.find((c) => /^names?\b/i.test(label(c)))!;
  const quotaCol = cols.find((c) => /quota|pledge|target/i.test(label(c))) ?? null;
  const remarksCol = cols.find((c) => /remark|comment|status/i.test(label(c))) ?? null;

  const data = dataRows(grid, headerRow, nameCol);
  const start = (quotaCol ?? nameCol) + 1;
  const end = remarksCol ?? width;
  const numeric = cols.filter((c) => c >= start && c < end && data.some((r) => norm(r.cells[c]) !== ""));

  // The total is a column labelled TOTAL, else the right-most numeric column.
  const labelledTotal = numeric.filter((c) => /total|paid/i.test(label(c)));
  let totalCol: number | null = labelledTotal.at(-1) ?? null;
  const instalmentCols = numeric.filter((c) => !labelledTotal.includes(c));
  if (totalCol === null && instalmentCols.length >= 2) totalCol = instalmentCols.pop()!;

  // Sheets often repeat the total in a second, unlabelled column. Treat the
  // column before the total as a duplicate only if it always equals the total
  // AND the remaining instalments add up to the total without it.
  if (totalCol !== null && instalmentCols.length >= 2) {
    const prev = instalmentCols[instalmentCols.length - 1];
    const rest = instalmentCols.slice(0, -1);
    const sum = (r: { cells: Cell[] }) =>
      rest.reduce((s, c) => s + (parseInstalmentCell(r.cells[c] ?? "") ?? []).reduce((a, p) => a + p.amountCents, 0), 0);
    const rows = data.filter((r) => norm(r.cells[totalCol!]));
    const duplicate =
      rows.length > 0 &&
      rows.every((r) => parseAmount(r.cells[prev]) === parseAmount(r.cells[totalCol!])) &&
      rows.filter((r) => sum(r) === parseAmount(r.cells[totalCol!])).length >= Math.ceil(rows.length * 0.6);
    if (duplicate) instalmentCols.pop();
  }
  return { headerRow, nameCol, quotaCol, instalmentCols, totalCol, remarksCol, year };
}

function dataRows(grid: Cell[][], headerRow: number, nameCol: number) {
  const out: { line: number; cells: Cell[] }[] = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => norm(c))) continue;
    // Skip a second header line (e.g. "REMARKS" alone under the main header).
    if (i === headerRow + 1 && !norm(cells[nameCol]) && cells.every((c) => !/\d/.test(norm(c)))) continue;
    out.push({ line: i + 1, cells });
  }
  return out;
}

export function parsePeople(grid: Cell[][], layout: YearLayout): ParsedPerson[] {
  const people: ParsedPerson[] = [];
  for (const { line, cells } of dataRows(grid, layout.headerRow, layout.nameCol)) {
    const rawName = norm(cells[layout.nameCol]);
    const errors: string[] = [];
    const warnings: string[] = [];

    const quota = layout.quotaCol === null ? null : parseAmount(cells[layout.quotaCol]);
    if (quota !== null && Number.isNaN(quota)) errors.push(`Quota “${norm(cells[layout.quotaCol!])}” isn't an amount`);

    const instalments: ParsedInstalment[] = [];
    for (const c of layout.instalmentCols) {
      const parsed = parseInstalmentCell(cells[c] ?? "");
      if (parsed === null) errors.push(`“${norm(cells[c])}” in column ${columnName(c)} isn't an amount`);
      else for (const p of parsed) instalments.push({ column: c, ...p });
    }
    const paidCents = instalments.reduce((s, i) => s + i.amountCents, 0);

    const total = layout.totalCol === null ? null : parseAmount(cells[layout.totalCol]);
    if (total !== null && Number.isNaN(total)) errors.push(`Total “${norm(cells[layout.totalCol!])}” isn't an amount`);
    const cleared = layout.remarksCol !== null && /clear|paid|complete/i.test(norm(cells[layout.remarksCol]));

    if (!rawName) {
      if (instalments.length || (quota && quota > 0)) errors.push("Amounts with no name. Is this part of the row above? Merge it in the sheet and upload again.");
      else continue;
    }
    if (total !== null && !Number.isNaN(total) && total !== paidCents) {
      warnings.push(`Payments add up to ${fmt(paidCents)} but the total column says ${fmt(total)}`);
    }
    if (cleared && quota !== null && !Number.isNaN(quota) && paidCents < quota) {
      warnings.push(`Marked CLEARED but ${fmt(quota - paidCents)} short of the quota`);
    }
    if (!instalments.length && !(quota && quota > 0)) warnings.push("No quota and no payments: nothing to import");

    people.push({
      line,
      rawName,
      name: displayName(rawName),
      quotaCents: quota === null || Number.isNaN(quota) ? null : quota,
      instalments,
      paidCents,
      totalCents: total === null || Number.isNaN(total) ? null : total,
      cleared,
      errors,
      warnings,
    });
  }
  // Same person twice on one sheet would double their payments.
  const seen = new Map<string, number>();
  for (const p of people) {
    const k = p.name.toLowerCase();
    if (!p.name) continue;
    if (seen.has(k)) p.errors.push(`Same name as row ${seen.get(k)}`);
    else seen.set(k, p.line);
  }
  return people;
}

/** Excel-style column letter: 0 -> A, 27 -> AB. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const fmt = (cents: number) => `KSh ${(cents / 100).toLocaleString("en-KE")}`;

/** A synthetic sheet in the same layout as the treasurer's, for trying the import. */
export const SAMPLE_YEAR_SHEET: Cell[][] = [
  ["QUOTA PAYMENT FOR THE YEAR 2025", "", "", "", "", "", "", "", "", ""],
  ["NO.", "NAME", "QUOTA", "", "", "", "", "", "", "REMARKS"],
  ["1", "MEMBER ONE", "20000", "", "20000", "", "", "20000", "20000", "CLEARED"],
  ["2", "PROF. A. MEMBER-TWO", "35000", "35000", "", "", "", "35000", "35000", "CLEARED"],
  ["3", "MEMBER THREE", "15000", "1000", "1000", "10000", "3200-M", "15200", "15200", "CLEARED"],
  ["4", "CPA MEMBER FOUR", "10000", "1000", "10000", "", "", "11000", "11000", "CLEARED"],
  ["5", "MEMBER FIVE", "8000", "1000", "1000 3200-M", "", "", "5200", "5200", ""],
  ["6", "MEMBER SIX", "2000", "500", "", "", "", "700", "700", ""],
  ["7", "MEMBER SEVEN", "6000", "2000", "3200 -M", "", "", "5000", "5000", "CLEARED"],
  ["8", "MEMBER EIGHT", "5000", "", "", "", "", "", "", ""],
];
