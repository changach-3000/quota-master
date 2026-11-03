import { AppShell, ProfileChip } from "@/components/shell/app-shell";
import { getViewer } from "@/lib/session";
import { Suspense } from "react";

const ROLE_LABEL = { admin: "Admin · full access", treasurer: "Treasurer · full access", auditor: "Auditor · read only", member: "Member" };

async function StaffProfile() {
  const viewer = await getViewer();
  if (!viewer) return null;
  return <ProfileChip initials={viewer.role.slice(0, 2).toUpperCase()} name="Parish office" detail={ROLE_LABEL[viewer.role]} />;
}

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      variant="staff"
      subtitle="Parish treasury"
      profile={
        <Suspense fallback={<div className="h-12" />}>
          <StaffProfile />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
