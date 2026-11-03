import { AppShell, ProfileChip } from "@/components/shell/app-shell";
import { getViewer } from "@/lib/session";
import { getMyProfile } from "@/services/member-dashboard";
import { Suspense } from "react";

async function MemberProfile() {
  const viewer = await getViewer();
  if (!viewer?.parishionerId) return null;
  const me = await getMyProfile(viewer);
  if (!me) return null;
  const initials = me.name
    .split(/\s+/)
    .map((w) => w.replace(/^0+/, "").charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <ProfileChip initials={initials} name={me.name} detail={`Member · ${me.church}`} />;
}

export default function MemberLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      variant="member"
      subtitle="My giving"
      profile={
        <Suspense fallback={<div className="h-12" />}>
          <MemberProfile />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
