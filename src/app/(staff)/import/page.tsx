import { PageHeader, StaffPage } from "@/components/app/page";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listParishionerOptions } from "@/services/contributions";
import { todayInNairobi } from "@/services/periods";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage() {
  return (
    <StaffPage>
      <PageHeader
        title="Import from Excel"
        description="Bring in past payments from the treasurer's spreadsheet. Every row is checked in a dry run before anything is saved."
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
  const { parishioners } = await listParishionerOptions(viewer, todayInNairobi());
  return <ImportWizard knownNames={parishioners.map((p) => p.name)} today={todayInNairobi()} />;
}
