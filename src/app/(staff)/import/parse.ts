import { MPESA_CODE } from "@/schemas/contribution";

// Client-side preview helpers for the import dry run. The server repeats every
// check when the import is committed; this only gives fast feedback.

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const TARGETS = [
  { key: "date", label: "Date received", required: true, guesses: ["date", "received", "day"] },
  { key: "name", label: "Parishioner", required: true, guesses: ["name", "parishioner", "member", "payer"] },
  { key: "amount", label: "Amount (KSh)", required: true, guesses: ["amount", "ksh", "paid", "sum"] },
  { key: "method", label: "Method", required: false, guesses: ["method", "mode", "type", "channel"] },
  { key: "reference", label: "M-Pesa code or receipt", required: false, guesses: ["code", "ref", "receipt", "mpesa", "transaction"] },
] as const;

export type TargetKey = (typeof TARGETS)[number]["key"];
export type Mapping = Partial<Record<TargetKey, number>>;

export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const t of TARGETS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && t.guesses.some((g) => h.toLowerCase().includes(g)));
    if (i >= 0) {
      mapping[t.key] = i;
      used.add(i);
    }
  }
  return mapping;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts 2026-03-12, 12/03/2026 (day first, as in Kenya) and 12 Mar 2026. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/)) && MONTHS[match[2].toLowerCase()])
    [d, m, y] = [Number(match[1]), MONTHS[match[2].toLowerCase()], Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export type RowResult = {
  line: number;
  date: string | null;
  name: string;
  amountCents: number | null;
  method: "mpesa" | "cash" | null;
  reference: string;
  errors: string[];
  warnings: string[];
};

export function dryRun(rows: string[][], mapping: Mapping, knownNames: Set<string>, today: string): RowResult[] {
  const seenCodes = new Map<string, number>();
  const cell = (r: string[], k: TargetKey) => (mapping[k] === undefined ? "" : (r[mapping[k]!] ?? "").trim());

  return rows.map((r, i) => {
    const line = i + 2; // header is line 1
    const errors: string[] = [];
    const warnings: string[] = [];

    const date = parseDate(cell(r, "date"));
    if (!date) errors.push(`Date “${cell(r, "date")}” isn't recognised`);
    else if (date > today) errors.push("Date is in the future");

    const name = cell(r, "name");
    if (!name) errors.push("No parishioner name");
    else if (!knownNames.has(name.toLowerCase())) errors.push(`“${name}” isn't on the parishioner list. Add them on the Parishioners page first`);

    const rawAmount = cell(r, "amount").replace(/ksh|,|\s/gi, "");
    const amountCents = /^\d+(\.\d{1,2})?$/.test(rawAmount) && Number(rawAmount) > 0 ? Math.round(Number(rawAmount) * 100) : null;
    if (amountCents === null) errors.push(`Amount “${cell(r, "amount")}” isn't a positive number`);

    const ref = cell(r, "reference").toUpperCase();
    const rawMethod = cell(r, "method").toLowerCase();
    let method: "mpesa" | "cash" | null = rawMethod.includes("cash") ? "cash" : rawMethod.includes("pesa") || rawMethod === "m" ? "mpesa" : null;
    if (!method) method = MPESA_CODE.test(ref) ? "mpesa" : ref ? "cash" : null;
    if (!method) errors.push("Can't tell if this was M-Pesa or cash");
    if (method === "mpesa") {
      if (!MPESA_CODE.test(ref)) errors.push(`M-Pesa code “${ref || "blank"}” should be 10 letters and numbers`);
      else if (seenCodes.has(ref)) errors.push(`Same M-Pesa code as line ${seenCodes.get(ref)}`);
      else seenCodes.set(ref, line);
    }
    if (method === "cash" && !ref) warnings.push("Cash with no receipt number");

    return { line, date, name, amountCents, method, reference: ref, errors, warnings };
  });
}

/** Synthetic sample in the shape of a typical treasurer spreadsheet. */
export const SAMPLE_CSV = `Date,Name,Amount,Mode,Ref
05/01/2026,Parishioner 004,"2,000",M-Pesa,SKA1B2C3D4
05/01/2026,Parishioner 017,1500,Cash,R-0101
12/01/2026,Parishioner 023,5000,M-Pesa,SKA9Z8Y7X6
12/01/2026,Parishioner 031,3000,mpesa,SKA9Z8Y7X6
19 Jan 2026,Parishioner 044,2500,Cash,R-0102
26/01/2026,Parishioner 052,,M-Pesa,SKB5C6D7E8
31/02/2026,Parishioner 060,1000,Cash,R-0103
02/02/2026,New Member Example,2000,Cash,R-0104
09/02/2026,Parishioner 071,4000,M-Pesa,SKC12345
16/02/2026,Parishioner 088,3500,M-Pesa,SKD4E5F6G7
`;
