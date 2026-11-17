"use client";

import { inputClass, selectClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { formatDate, formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { YearSheetResult } from "@/services/year-sheet-import";
import { CalendarDays, Check, CircleAlert, CircleCheck, FileSpreadsheet, LoaderCircle, Smartphone, TriangleAlert, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { importYearSheetAction } from "./actions";
import { readGrid } from "./read-file";
import { columnName, detectLayout, parsePeople, SAMPLE_YEAR_SHEET, type ParsedPerson, type YearLayout } from "./year-sheet-parse";

type Period = { id: string; name: string; startsOn: string; endsOn: string };
type Church = { id: string; name: string };

const STEPS = ["Upload", "Set up", "Review", "Import"] as const;

export function YearSheetWizard({
  periods,
  churches,
  namesByChurch,
  today,
}: {
  periods: Period[];
  churches: Church[];
  namesByChurch: Record<string, string[]>;
  today: string;
}) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  const [layout, setLayout] = useState<YearLayout | null>(null);
  const [uploadError, setUploadError] = useState<string>();
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [churchId, setChurchId] = useState(churches[0]?.id ?? "");
  const [asOf, setAsOf] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [dateRows, setDateRows] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Extract<YearSheetResult, { ok: true }> | null>(null);

  const period = periods.find((p) => p.id === periodId);
  const maxDate = period ? (period.endsOn < today ? period.endsOn : today) : today;
  const people = useMemo(() => (layout ? parsePeople(grid, layout) : []), [grid, layout]);
  const known = useMemo(() => new Set((namesByChurch[churchId] ?? []).map((n) => n.toLowerCase())), [namesByChurch, churchId]);
  const importable = people.filter((p) => p.errors.length === 0 && (p.instalments.length > 0 || (p.quotaCents ?? 0) > 0));
  const withErrors = people.filter((p) => p.errors.length > 0);
  const withWarnings = importable.filter((p) => p.warnings.length > 0);
  const newPeople = importable.filter((p) => !known.has(p.name.toLowerCase()));
  const payments = importable.flatMap((p) => p.instalments);
  const paymentCents = payments.reduce((s, i) => s + i.amountCents, 0);
  const mpesaCount = payments.filter((i) => i.method === "mpesa").length;
  const quotaCents = importable.reduce((s, p) => s + (p.quotaCents ?? 0), 0);
  const datedCount = Object.values(dates).filter(Boolean).length;
  const key = (p: ParsedPerson, i: number) => `${p.line}:${i}`;

  function load(name: string, rows: string[][]) {
    const detected = detectLayout(rows);
    if (!detected) {
      setUploadError("Couldn't find a header row with a NAME column. Check this is the yearly quota sheet.");
      return;
    }
    setUploadError(undefined);
    setFileName(name);
    setGrid(rows);
    setLayout(detected);
    const match = periods.find((p) => detected.year && p.name.includes(String(detected.year)));
    const chosen = match ?? periods[0];
    if (chosen) {
      setPeriodId(chosen.id);
      setAsOf(chosen.endsOn < today ? chosen.endsOn : today);
    }
    setDates({});
    setDateRows(new Set());
    setStep(1);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      load(file.name, await readGrid(file));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "That file couldn't be read.");
    }
  }

  function setCol(field: "nameCol" | "quotaCol" | "totalCol" | "remarksCol", value: string) {
    if (!layout) return;
    const n = value === "" ? null : Number(value);
    if (field === "nameCol" && n === null) return;
    setLayout({ ...layout, [field]: n, instalmentCols: layout.instalmentCols.filter((c) => c !== n) });
  }

  function toggleInstalment(c: number) {
    if (!layout) return;
    const has = layout.instalmentCols.includes(c);
    setLayout({ ...layout, instalmentCols: has ? layout.instalmentCols.filter((x) => x !== c) : [...layout.instalmentCols, c].sort((a, b) => a - b) });
  }

  async function commit() {
    if (pending || !period) return;
    setPending(true);
    try {
      const result = await importYearSheetAction({
        fileName: fileName ?? "year-sheet.xlsx",
        periodId,
        churchId,
        asOfDate: asOf,
        rows: importable.map((p) => ({
          line: p.line,
          name: p.name,
          quotaCents: p.quotaCents,
          instalments: p.instalments.map((i, n) => ({ column: i.column, amountCents: i.amountCents, method: i.method, date: dates[key(p, n)] || null })),
        })),
      });
      if (!result.ok) {
        toast.error("Import failed", { description: result.message });
        return;
      }
      setOutcome(result);
      setStep(4);
    } catch {
      toast.error("Couldn't reach the server", { description: "It is safe to press Import again: nothing already saved is recorded twice." });
    } finally {
      setPending(false);
    }
  }

  const width = Math.max(0, ...grid.map((r) => r.length));
  const header = layout ? grid[layout.headerRow] ?? [] : [];
  const colLabel = (c: number) => {
    const h = `${header[c] ?? ""} ${grid[(layout?.headerRow ?? 0) + 1]?.[c] ?? ""}`.trim();
    return `${columnName(c)}${h ? ` · ${h}` : ""}`;
  };
  const example = (c: number) => people.find((p) => grid[p.line - 1]?.[c])?.line;

  return (
    <div className="flex flex-col gap-4">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13px] font-medium",
              i === step ? "border-primary bg-positive-soft text-positive-text" : i < step ? "border-border bg-card" : "border-border bg-card text-muted-foreground",
            )}
          >
            <span className={cn("flex size-6 items-center justify-center rounded-full text-xs", i <= step ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel className="flex flex-col gap-4 p-6">
          <label
            htmlFor="year-file"
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-background px-6 py-12 text-center hover:border-primary hover:bg-positive-soft/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-positive-soft text-positive-text">
              <Upload className="size-5" aria-hidden />
            </span>
            <span className="font-medium">Drop the yearly quota sheet here, or choose the file</span>
            <span className="max-w-md text-[13px] text-muted-foreground">
              Excel (.xlsx) or CSV. One row per person: name, quota, then each payment in its own cell. Write “-M” after M-Pesa amounts, like 3200-M.
            </span>
            <input
              id="year-file"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {uploadError && (
            <p role="alert" className="flex gap-2 text-[13px] font-medium text-negative">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              {uploadError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted-foreground">
            <span>Nothing is saved until the last step. Try it with a synthetic sheet in the same layout.</span>
            <button type="button" onClick={() => load("sample-yearly-sheet.xlsx", SAMPLE_YEAR_SHEET)} className={buttonClass("secondary")}>
              <FileSpreadsheet className="size-4" aria-hidden />
              Use sample sheet
            </button>
          </div>
        </Panel>
      )}

      {step === 1 && layout && (
        <Panel className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-base font-semibold">Set up the import</h2>
            <p className="text-[13px] text-muted-foreground">
              {fileName} · {people.length} people found. The columns were worked out from the sheet; check them.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              id="ys-period"
              label="Year (quota period)"
              value={periodId}
              onChange={(v) => {
                setPeriodId(v);
                const next = periods.find((p) => p.id === v);
                if (next) setAsOf(next.endsOn < today ? next.endsOn : today);
              }}
              options={periods.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Select id="ys-church" label="Church" value={churchId} onChange={setChurchId} options={churches.map((c) => ({ value: c.id, label: c.name }))} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ys-asof" className="text-[13px] font-medium">
                Date for payments with no date
              </label>
              <input
                id="ys-asof"
                type="date"
                value={asOf}
                min={period?.startsOn}
                max={maxDate}
                onChange={(e) => setAsOf(e.target.value)}
                className={inputClass}
              />
              <span className="text-xs text-muted-foreground">Shown as “date not recorded”. You can add real dates in the next step.</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Select id="ys-name" label="Name column" value={String(layout.nameCol)} onChange={(v) => setCol("nameCol", v)} options={cols(width).map((c) => ({ value: String(c), label: colLabel(c) }))} />
            <Select id="ys-quota" label="Quota column" value={layout.quotaCol === null ? "" : String(layout.quotaCol)} onChange={(v) => setCol("quotaCol", v)} options={cols(width).map((c) => ({ value: String(c), label: colLabel(c) }))} allowNone />
            <Select id="ys-total" label="Total column (for checking)" value={layout.totalCol === null ? "" : String(layout.totalCol)} onChange={(v) => setCol("totalCol", v)} options={cols(width).map((c) => ({ value: String(c), label: colLabel(c) }))} allowNone />
            <Select id="ys-remarks" label="Remarks column" value={layout.remarksCol === null ? "" : String(layout.remarksCol)} onChange={(v) => setCol("remarksCol", v)} options={cols(width).map((c) => ({ value: String(c), label: colLabel(c) }))} allowNone />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium">Payment columns</legend>
            <div className="flex flex-wrap gap-2">
              {cols(width)
                .filter((c) => c !== layout.nameCol && c !== layout.quotaCol && c !== layout.totalCol && c !== layout.remarksCol)
                .map((c) => {
                  const on = layout.instalmentCols.includes(c);
                  const ex = example(c);
                  return (
                    <label
                      key={c}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px]",
                        on ? "border-primary bg-positive-soft text-positive-text" : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleInstalment(c)} className="size-4 accent-[var(--primary)]" />
                      <span className="font-medium">{columnName(c)}</span>
                      {ex && <span className="font-mono text-xs">e.g. {grid[ex - 1][c]}</span>}
                    </label>
                  );
                })}
            </div>
          </fieldset>

          <div className="flex justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setStep(0)} className={buttonClass("secondary")}>
              Back
            </button>
            <button type="button" disabled={!periodId || !churchId || !asOf || layout.instalmentCols.length === 0} onClick={() => setStep(2)} className={buttonClass("primary")}>
              Review {people.length} people
            </button>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
            <Summary tone="positive" icon={CircleCheck} label="People to import" value={String(importable.length)} note={`${newPeople.length} new to ${churches.find((c) => c.id === churchId)?.name}`} />
            <Summary tone="info" icon={Smartphone} label="Payments" value={formatKsh(paymentCents)} note={`${payments.length} payments · ${mpesaCount} M-Pesa`} />
            <Summary tone="info" icon={CalendarDays} label="Pledges (quota)" value={formatKsh(quotaCents)} note={`For ${period?.name}`} />
            <Summary tone="warning" icon={TriangleAlert} label="To check" value={String(withWarnings.length)} note="Imported; totals look off" />
            <Summary tone="negative" icon={CircleAlert} label="Not imported" value={String(withErrors.length)} note="Fix in the sheet first" />
          </div>

          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-[18px]">
              <div>
                <h2 className="text-base font-semibold">Review</h2>
                <p className="text-[13px] text-muted-foreground">
                  Nothing is saved yet. Payments with no date get {asOf ? formatDate(asOf) : "the date you chose"}, marked “date not recorded”. Add real
                  dates where you know them. {datedCount > 0 && `${datedCount} dated so far.`}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-t border-b border-border bg-background text-left text-muted-foreground">
                    <th className="py-2.5 pr-3 pl-5 font-medium">Row</th>
                    <th className="px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 text-right font-medium">Quota</th>
                    <th className="px-3 py-2.5 font-medium">Payments</th>
                    <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                    <th className="py-2.5 pr-5 pl-3 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const isNew = !known.has(p.name.toLowerCase());
                    const showDates = dateRows.has(p.line);
                    return (
                      <tr key={p.line} className={cn("border-b border-slate-100 align-top", p.errors.length && "bg-negative-soft/50")}>
                        <td className="py-3 pr-3 pl-5 text-muted-foreground tabular">{p.line}</td>
                        <td className="px-3 py-3">
                          <span className="flex flex-col gap-0.5">
                            <span className="font-medium">{p.name || "—"}</span>
                            {p.name && isNew && (
                              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                                <UserPlus className="size-3" aria-hidden /> New parishioner
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular">{p.quotaCents ? formatKsh(p.quotaCents) : "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {p.instalments.map((i, n) => (
                              <span key={n} className="flex flex-col gap-1">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs tabular",
                                    i.method === "mpesa" ? "border-green-200 bg-positive-soft text-positive-text" : "border-border bg-card",
                                  )}
                                  title={i.method === "mpesa" ? "M-Pesa" : "Cash"}
                                >
                                  {(i.amountCents / 100).toLocaleString("en-KE")}
                                  {i.method === "mpesa" && <span className="font-sans text-[10px] font-semibold">M-PESA</span>}
                                </span>
                                {showDates && (
                                  <>
                                    <label htmlFor={`d-${key(p, n)}`} className="sr-only">
                                      Date of {formatKsh(i.amountCents)} payment from {p.name}
                                    </label>
                                    <input
                                      id={`d-${key(p, n)}`}
                                      type="date"
                                      min={period?.startsOn}
                                      max={maxDate}
                                      value={dates[key(p, n)] ?? ""}
                                      onChange={(e) => setDates((d) => ({ ...d, [key(p, n)]: e.target.value }))}
                                      className="h-8 rounded-md border border-input bg-card px-1.5 text-xs"
                                    />
                                  </>
                                )}
                              </span>
                            ))}
                            {p.instalments.length > 0 && !p.errors.length && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDateRows((s) => {
                                    const next = new Set(s);
                                    if (next.has(p.line)) next.delete(p.line);
                                    else next.add(p.line);
                                    return next;
                                  })
                                }
                                className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary hover:bg-positive-soft"
                              >
                                <CalendarDays className="size-3.5" aria-hidden />
                                {showDates ? "Hide dates" : "Add dates"}
                              </button>
                            )}
                            {p.instalments.length === 0 && <span className="text-muted-foreground">None</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular">{formatKsh(p.paidCents)}</td>
                        <td className="py-3 pr-5 pl-3">
                          {p.errors.length === 0 && p.warnings.length === 0 && (
                            <span className="inline-flex items-center gap-1 text-positive-text">
                              <CircleCheck className="size-3.5" aria-hidden /> OK
                            </span>
                          )}
                          <ul className="flex flex-col gap-0.5">
                            {p.errors.map((e) => (
                              <li key={e} className="flex gap-1.5 text-negative">
                                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                                {e}
                              </li>
                            ))}
                            {p.warnings.map((w) => (
                              <li key={w} className="flex gap-1.5 text-warning-text">
                                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                                {w}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => setStep(1)} className={buttonClass("secondary")}>
              Back to set-up
            </button>
            <button type="button" disabled={importable.length === 0} onClick={() => setStep(3)} className={buttonClass("primary")}>
              Continue with {importable.length} people
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <Panel className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold">Confirm import</h2>
          <ul className="flex flex-col gap-2 text-[13px] text-slate-700">
            <li>
              <strong>{importable.length}</strong> people into <strong>{churches.find((c) => c.id === churchId)?.name}</strong>, of whom{" "}
              <strong>{newPeople.length}</strong> will be added as new parishioners.
            </li>
            <li>
              Their quota becomes their <strong>{period?.name}</strong> pledge (a new version if a different pledge already exists).
            </li>
            <li>
              <strong>{payments.length}</strong> payments totalling <strong>{formatKsh(paymentCents)}</strong> are recorded as <strong>Historical</strong>: they
              need no M-Pesa code or receipt, and they never appear in deposits, since that money was banked long ago.
            </li>
            <li>
              {payments.length - datedCount} payment{payments.length - datedCount === 1 ? "" : "s"} without a date get {asOf && formatDate(asOf)} and are marked “date
              not recorded”.
            </li>
            <li>Importing the same sheet again is safe: nothing already saved is recorded twice.</li>
          </ul>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setStep(2)} className={buttonClass("secondary")}>
              Back
            </button>
            <button type="button" onClick={commit} disabled={pending} className={buttonClass("primary")}>
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {pending ? "Importing…" : `Import ${importable.length} people`}
            </button>
          </div>
        </Panel>
      )}

      {step === 4 && outcome && (
        <Panel className="flex flex-col gap-4 p-6" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive-text">
              <CircleCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">Import finished</h2>
              <p className="text-[13px] text-muted-foreground">{fileName}</p>
            </div>
          </div>
          <dl className="grid gap-3 text-[13px] sm:grid-cols-4">
            <Stat label="Payments recorded" value={`${outcome.payments.recorded} · ${formatKsh(outcome.payments.recordedCents)}`} good />
            <Stat label="Already in the ledger" value={String(outcome.payments.alreadyImported)} />
            <Stat label="Pledges set" value={`${outcome.pledges.set} (${outcome.pledges.unchanged} unchanged)`} />
            <Stat label="New parishioners" value={String(outcome.people.added)} />
          </dl>
          {[...outcome.skipped.map((s) => ({ line: s.line, text: s.reason })), ...outcome.notes.map((n) => ({ line: n.line, text: n.note }))].length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-[10px] border border-amber-200 bg-warning-soft p-3 text-[13px] text-warning-text">
              {outcome.skipped.map((s) => (
                <li key={`s${s.line}`}>
                  <span className="font-medium tabular">Row {s.line} skipped:</span> {s.reason}
                </li>
              ))}
              {outcome.notes.map((n) => (
                <li key={`n${n.line}`}>
                  <span className="font-medium tabular">Row {n.line}:</span> {n.note}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setGrid([]);
                setLayout(null);
                setOutcome(null);
              }}
              className={buttonClass("secondary")}
            >
              Import another sheet
            </button>
            <Link href="/pledges" className={buttonClass("primary")}>
              See pledges
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
}

const cols = (width: number) => Array.from({ length: width }, (_, c) => c);

function Select({
  id,
  label,
  value,
  onChange,
  options,
  allowNone,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {allowNone && <option value="">Not in this sheet</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className={cn("rounded-[10px] p-3", good ? "bg-positive-soft" : "bg-muted")}>
      <dt className={good ? "text-positive-text" : "text-muted-foreground"}>{label}</dt>
      <dd className="text-base font-semibold tabular">{value}</dd>
    </div>
  );
}

function Summary({
  icon: Icon,
  tone,
  label,
  value,
  note,
}: {
  icon: typeof CircleCheck;
  tone: "positive" | "warning" | "negative" | "info";
  label: string;
  value: string;
  note: string;
}) {
  const tones = {
    positive: "bg-positive-soft text-positive-text",
    warning: "bg-warning-soft text-warning-text",
    negative: "bg-negative-soft text-negative",
    info: "bg-blue-50 text-blue-700",
  };
  return (
    <Panel className="flex items-center gap-3 p-4">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px]", tones[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{note}</span>
      </span>
    </Panel>
  );
}
