import { buttonClass } from "@/components/app/page";
import { inspectToken } from "@/services/auth";
import { Church, LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

export default function SetPasswordPage({ params }: PageProps<"/set-password/[token]">) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-positive text-white">
            <Church className="size-[18px]" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-[15px] font-semibold">Quota Master</span>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
          <Body params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Body({ params }: { params: PageProps<"/set-password/[token]">["params"] }) {
  const { token } = await params;
  const info = await inspectToken(token);

  if (info.status !== "valid") {
    const message = {
      expired: "This link has expired.",
      used: "This link has already been used.",
      invalid: "This link isn't valid.",
    }[info.status];
    return (
      <div className="flex flex-col gap-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LinkIcon className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">{message}</h1>
          <p className="mt-1 text-muted-foreground">Ask the parish office for a new link. If you have already set a password, sign in instead.</p>
        </div>
        <Link href="/login" className={buttonClass("primary", "h-11")}>
          Go to sign in
        </Link>
      </div>
    );
  }

  const invite = info.purpose === "invite";
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{invite ? "Welcome to Quota Master" : "Choose a new password"}</h1>
        <p className="mt-1 text-muted-foreground">
          {invite ? "Set a password to finish setting up" : "Set a new password for"} <strong className="font-medium text-foreground">{info.email}</strong>.
        </p>
      </div>
      <SetPasswordForm token={token} email={info.email} cta={invite ? "Set password and sign in" : "Save new password"} />
    </>
  );
}
