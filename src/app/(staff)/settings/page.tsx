import { PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listChurches } from "@/services/contributions";
import { getParishSetup, listUnlinkedParishioners, listUsers } from "@/services/settings";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsTabs } from "./settings-tabs";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <StaffPage>
      <PageHeader title="Settings" description="Churches, quota periods and who can sign in." />
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Loader />
      </Suspense>
    </StaffPage>
  );
}

async function Loader() {
  const viewer = await requireStaffViewer();
  const [setup, users, churches, unlinked] = await Promise.all([
    getParishSetup(viewer),
    listUsers(viewer),
    listChurches(viewer),
    listUnlinkedParishioners(viewer),
  ]);
  return (
    <SettingsTabs
      setup={setup}
      users={users}
      churches={churches}
      unlinked={unlinked}
      canEdit={canWrite(viewer)}
      isAdmin={viewer.role === "admin"}
      viewerId={viewer.userId}
    />
  );
}
