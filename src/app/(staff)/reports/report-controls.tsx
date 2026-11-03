"use client";

import { selectClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";

export function PeriodPicker({ periods, value }: { periods: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="report-period" className="sr-only">
        Quota period
      </label>
      <select
        id="report-period"
        value={value}
        onChange={(e) => router.push(`/reports?period=${e.target.value}`)}
        className={cn(selectClass, "h-10 w-auto min-w-36 print:hidden")}
      >
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} period
          </option>
        ))}
      </select>
    </>
  );
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary", "print:hidden")}>
      <Printer className="size-4" aria-hidden />
      Print
    </button>
  );
}
