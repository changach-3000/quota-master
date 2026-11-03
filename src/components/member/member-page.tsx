import { PageBody } from "@/components/app/page";
import { NotificationsButton, TopBar } from "@/components/shell/top-bar";
import type { ReactNode } from "react";
import { HowToGiveButton } from "./how-to-give";

export function MemberPage({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <>
      <TopBar
        start={
          <div className="flex-[1_1_240px]">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
        }
      >
        <NotificationsButton />
        <HowToGiveButton />
      </TopBar>
      <PageBody>{children}</PageBody>
    </>
  );
}
