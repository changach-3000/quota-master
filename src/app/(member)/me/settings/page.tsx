import { TableSkeleton } from "@/components/app/page";
import { MemberPage } from "@/components/member/member-page";
import { requireMemberViewer } from "@/lib/session";
import { getMyProfile } from "@/services/member-dashboard";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MemberSettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default function MemberSettingsPage() {
  return (
    <MemberPage title="Settings" description="Your contact details and password.">
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Loader />
      </Suspense>
    </MemberPage>
  );
}

async function Loader() {
  const viewer = await requireMemberViewer();
  const me = await getMyProfile(viewer);
  return <MemberSettingsForms name={me?.name ?? ""} church={me?.church ?? ""} email={me?.email ?? ""} />;
}
