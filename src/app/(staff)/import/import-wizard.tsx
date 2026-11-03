"use client";

import { selectClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Check, CircleAlert, CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { dryRun, guessMapping, parseCsv, SAMPLE_CSV, TARGETS, type Mapping } from "./parse";

const STEPS = ["Upload", "Match columns", "Dry run", "Import"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

export function ImportWizard({ knownNames, today }: { knownNames: string[]; today: string }) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [uploadError, setUploadError] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  const headers = table[0] ?? [];
  const body = table.slice(1);
  const known = useMemo(() => new Set(knownNames.map((n) => n.toLowerCase())), [knownNames]);
  const results = useMemo(() => (step >= 2 ? dryRun(body, mapping, known, today) : []), [step, body, mapping, known, today]);
  const bad = results.filter((r) => r.errors.length);
  const warn = results.filter((r) => !r.errors.length && r.warnings.length);
  const good = results.filter((r) => !r.errors.length);
  const goodTotal = good.reduce((s, r) => s + (r.amountCents ?? 0), 0);
  const missingRequired = TARGETS.filter((t) => t.required && mapping[t.key] === undefined);

  function load(name: string, text: string) {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      setUploadError("That file has no data rows under the header.");
      return;
    }
    setUploadError(undefined);
    setFileName(name);
    setTable(rows);
    setMapping(guessMapping(rows[0]));
    setStep(1);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) return setUploadError("Files up to 5 MB, please.");
    if (!/\.csv$/i.test(file.name)) {
      return setUploadError("For now, save the sheet as CSV first (Excel: File › Save As › CSV UTF-8). Direct .xlsx upload comes with the backend.");
    }
    load(file.name, await file.text());
  }

  function commit() {
    toast.success(`${good.length} rows (${formatKsh(goodTotal)}) are ready to import`, {
      description: `${bad.length} rows with errors will be skipped. Saving is connected in the backend milestone.`,
    });
  }

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
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs",
                i < step ? "bg-primary text-white" : i === step ? "bg-primary text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel className="flex flex-col gap-4 p-6">
          <label
            htmlFor="import-file"
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
            <span className="font-medium">Drop a CSV here, or choose a file</span>
            <span className="text-[13px] text-muted-foreground">One row per payment. Up to 5 MB. Use anonymised data while testing.</span>
            <input id="import-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {uploadError && (
            <p role="alert" className="flex gap-2 text-[13px] font-medium text-negative">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              {uploadError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted-foreground">
            <span>No file handy? Try a synthetic sample with a few deliberate mistakes.</span>
            <button type="button" onClick={() => load("sample-payments.csv", SAMPLE_CSV)} className={buttonClass("secondary")}>
              <FileSpreadsheet className="size-4" aria-hidden />
              Use sample file
            </button>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-base font-semibold">Match your columns</h2>
            <p className="text-[13px] text-muted-foreground">
              {fileName} · {body.length} rows. We guessed from the headers; check each one.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <div key={t.key} className="flex flex-col gap-1.5">
                <label htmlFor={`map-${t.key}`} className="text-[13px] font-medium">
                  {t.label}
                  {!t.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
                </label>
                <select
                  id={`map-${t.key}`}
                  className={selectClass}
                  value={mapping[t.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [t.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                >
                  <option value="">Not in this file</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`} · e.g. “{body[0]?.[i] ?? ""}”
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <p className="text-[13px] font-medium text-warning-text">Still needed: {missingRequired.map((t) => t.label).join(", ")}.</p>
          )}
          <div className="flex justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setStep(0)} className={buttonClass("secondary")}>
              Back
            </button>
            <button type="button" disabled={missingRequired.length > 0} onClick={() => setStep(2)} className={buttonClass("primary")}>
              Run dry run
            </button>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <Summary icon={CircleCheck} tone="positive" label="Ready to import" value={`${good.length} rows`} note={formatKsh(goodTotal)} />
            <Summary icon={TriangleAlert} tone="warning" label="Ready, with warnings" value={`${warn.length} rows`} note="Imported; check them" />
            <Summary icon={CircleAlert} tone="negative" label="Errors" value={`${bad.length} rows`} note="Skipped until fixed" />
          </div>
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-[18px]">
              <div>
                <h2 className="text-base font-semibold">Dry run results</h2>
                <p className="text-[13px] text-muted-foreground">Nothing has been saved. Fix errors in the spreadsheet and upload again, or import the good rows.</p>
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Show all rows
              </label>
            </div>
            <Table className="min-w-[720px] text-[13px]">
              <TableHeader>
                <TableRow className="border-t border-border bg-background hover:bg-background">
                  <TableHead className="pl-5 font-medium text-muted-foreground">Line</TableHead>
                  <TableHead className="font-medium text-muted-foreground">Date</TableHead>
                  <TableHead className="font-medium text-muted-foreground">Parishioner</TableHead>
                  <TableHead className="font-medium text-muted-foreground">Reference</TableHead>
                  <TableHead className="text-right font-medium text-muted-foreground">Amount</TableHead>
                  <TableHead className="pr-5 font-medium text-muted-foreground">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(showAll ? results : [...bad, ...warn]).map((r) => (
                  <TableRow key={r.line} className="border-slate-100 align-top">
                    <TableCell className="py-3 pl-5 text-muted-foreground tabular">{r.line}</TableCell>
                    <TableCell className="py-3 whitespace-nowrap tabular">{r.date ? formatDate(r.date) : "—"}</TableCell>
                    <TableCell className="py-3">{r.name || "—"}</TableCell>
                    <TableCell className="py-3 font-mono text-xs">{r.reference || "—"}</TableCell>
                    <TableCell className="py-3 text-right tabular">{r.amountCents ? formatKsh(r.amountCents) : "—"}</TableCell>
                    <TableCell className="py-3 pr-5">
                      {r.errors.length === 0 && r.warnings.length === 0 && (
                        <span className="inline-flex items-center gap-1 text-positive-text">
                          <CircleCheck className="size-3.5" aria-hidden /> OK
                        </span>
                      )}
                      <ul className="flex flex-col gap-0.5">
                        {r.errors.map((e) => (
                          <li key={e} className="flex gap-1.5 text-negative">
                            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {e}
                          </li>
                        ))}
                        {r.warnings.map((w) => (
                          <li key={w} className="flex gap-1.5 text-warning-text">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!showAll && bad.length + warn.length === 0 && <p className="px-5 py-6 text-center text-positive-text">Every row passed.</p>}
          </Panel>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => setStep(1)} className={buttonClass("secondary")}>
              Back to columns
            </button>
            <button type="button" disabled={good.length === 0} onClick={() => setStep(3)} className={buttonClass("primary")}>
              Continue with {good.length} rows
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <Panel className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold">Confirm import</h2>
          <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
            <div className="rounded-[10px] bg-muted p-3">
              <dt className="text-muted-foreground">Rows to import</dt>
              <dd className="text-lg font-semibold tabular">{good.length}</dd>
            </div>
            <div className="rounded-[10px] bg-muted p-3">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-lg font-semibold tabular">{formatKsh(goodTotal)}</dd>
            </div>
            <div className="rounded-[10px] bg-muted p-3">
              <dt className="text-muted-foreground">Skipped (errors)</dt>
              <dd className="text-lg font-semibold tabular">{bad.length}</dd>
            </div>
          </dl>
          <p className="text-[13px] text-muted-foreground">
            Imported rows are recorded as ordinary payments, marked as imported in the audit log, and can only be corrected by reversal. Running the same
            file twice is safe: M-Pesa codes already in the ledger are rejected.
          </p>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setStep(2)} className={buttonClass("secondary")}>
              Back
            </button>
            <button type="button" onClick={commit} className={buttonClass("primary")}>
              <Upload className="size-4" aria-hidden />
              Import {good.length} rows
            </button>
          </div>
        </Panel>
      )}
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
  tone: "positive" | "warning" | "negative";
  label: string;
  value: string;
  note: string;
}) {
  const tones = { positive: "bg-positive-soft text-positive-text", warning: "bg-warning-soft text-warning-text", negative: "bg-negative-soft text-negative" };
  return (
    <Panel className="flex items-center gap-3 p-4">
      <span className={cn("flex size-10 items-center justify-center rounded-[10px]", tones[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular">{value}</span>
        <span className="text-xs text-muted-foreground tabular">{note}</span>
      </span>
    </Panel>
  );
}
