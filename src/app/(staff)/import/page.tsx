import { PageHeader, StaffPage } from "@/components/app/page";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listChurches, listParishionerOptions } from "@/services/contributions";
import { listNamesByChurch } from "@/services/parishioners";
import { listPeriods } from "@/services/reports";
import { todayInNairobi } from "@/services/periods";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ImportChooser } from "./import-chooser";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage() {
  return (
    <StaffPage>
      <PageHeader
        title="Import from Excel"
        description="Bring in the treasurer's yearly quota sheet or a list of payments. Everything is checked before anything is saved."
      />
      <Suspense fallback={<div className="h-[480px] animate-pulse rounded-xl bg-muted" />}>
        <Loader />
      </Suspense>
    </StaffPage>
  );
}

async function Loader() {
  const viewer = await requireStaffViewer();
  if (!canWrite(viewer)) redirect("/dashboard");
  const today = todayInNairobi();
  const [{ parishioners }, periods, churches, namesByChurch] = await Promise.all([
    listParishionerOptions(viewer, today),
    listPeriods(viewer),
    listChurches(viewer),
    listNamesByChurch(viewer),
  ]);
  return (
    <ImportChooser
      knownNames={parishioners.map((p) => p.name)}
      today={today}
      periods={periods}
      churches={churches}
      namesByChurch={namesByChurch}
    />
  );
}
