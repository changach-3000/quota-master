import { PageHeader, StaffPage } from "@/components/app/page";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listParishionerOptions } from "@/services/contributions";
import { todayInNairobi } from "@/services/periods";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { RecordPaymentForm } from "./record-payment-form";

export const metadata: Metadata = { title: "Record payment" };

export default function RecordPaymentPage() {
  return (
    <StaffPage>
      <PageHeader
        title="Record payment"
        description="One payment at a time. M-Pesa codes are checked so a payment can't be entered twice."
        back={{ href: "/contributions", label: "Contributions" }}
      />
      <Suspense fallback={<div className="h-[560px] animate-pulse rounded-xl bg-muted" />}>
        <FormLoader />
      </Suspense>
    </StaffPage>
  );
}

async function FormLoader() {
  const viewer = await requireStaffViewer();
  if (!canWrite(viewer)) redirect("/contributions");
  const today = todayInNairobi();
  const { period, parishioners } = await listParishionerOptions(viewer, today);
  return <RecordPaymentForm parishioners={parishioners} today={today} periodName={period?.name ?? null} />;
}
