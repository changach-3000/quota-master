import { getViewer } from "@/lib/session";
import { STAFF_ROLES } from "@/services/viewer";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export default function Home() {
  return (
    <Suspense>
      <RouteByRole />
    </Suspense>
  );
}

async function RouteByRole() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  redirect(STAFF_ROLES.includes(viewer.role) ? "/dashboard" : "/me");
  return null;
}
