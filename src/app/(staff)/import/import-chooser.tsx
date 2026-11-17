"use client";

import { Segmented } from "@/components/app/form";
import { useState } from "react";
import { ImportWizard } from "./import-wizard";
import { YearSheetWizard } from "./year-sheet-wizard";

type Props = {
  knownNames: string[];
  today: string;
  periods: { id: string; name: string; startsOn: string; endsOn: string }[];
  churches: { id: string; name: string }[];
  namesByChurch: Record<string, string[]>;
};

/** Two kinds of file: the treasurer's yearly sheet, or a plain list of payments. */
export function ImportChooser({ knownNames, today, periods, churches, namesByChurch }: Props) {
  const [mode, setMode] = useState<"year" | "list">("year");
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xl">
        <Segmented
          label="Kind of file"
          value={mode}
          onChange={setMode}
          options={[
            { value: "year", label: "Yearly sheet (one row per person)" },
            { value: "list", label: "Payment list (one row per payment)" },
          ]}
        />
      </div>
      {mode === "year" ? (
        <YearSheetWizard periods={periods} churches={churches} namesByChurch={namesByChurch} today={today} />
      ) : (
        <ImportWizard knownNames={knownNames} today={today} />
      )}
    </div>
  );
}
