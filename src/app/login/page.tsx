import { prisma } from "@/lib/db";
import { devLoginEnabled } from "@/lib/session";
import { Church, Landmark, Lock, ScrollText, Smartphone, Target } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { signInAsDemo } from "./actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const FEATURES = [
  {
    icon: Target,
    title: "Quotas and pledges in one place",
    body: "Each church's quota, every parishioner's pledge, and the gap between them, always up to date.",
  },
  {
    icon: Smartphone,
    title: "M-Pesa and cash, recorded once",
    body: "Every M-Pesa code is checked so the same payment can never be counted twice.",
  },
  {
    icon: Landmark,
    title: "Deposits you can trace",
    body: "See exactly which payments went into each NCBA deposit, and what is still waiting.",
  },
  {
    icon: ScrollText,
    title: "Nothing is edited or deleted",
    body: "Corrections are recorded as reversals with a reason, and every action is kept in an audit log.",
  },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* About */}
      <section aria-labelledby="about-title" className="flex flex-col gap-6 bg-sidebar px-6 py-6 text-sidebar-foreground sm:gap-10 sm:px-12 sm:py-8 lg:py-12">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-sunshine text-foreground">
            <Church className="size-[18px]" strokeWidth={2} aria-hidden />
          </span>
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold text-white">Quota Master</span>
            <span className="text-xs text-sidebar-muted">Parish treasury</span>
          </span>
        </div>

        <div className="flex max-w-xl flex-col gap-4 lg:my-auto">
          <h1 id="about-title" className="text-2xl leading-tight font-semibold tracking-tight text-white sm:text-4xl">
            Church quotas and contributions, kept clear and accountable.
          </h1>
          <p className="hidden text-[15px] leading-relaxed text-sidebar-foreground sm:block">
            Quota Master replaces the treasurer&apos;s spreadsheet. It tracks what each church owes toward its parish quota, what every
            parishioner has pledged and given, and which money has been banked.
          </p>
          <ul className="mt-4 hidden flex-col gap-5 sm:flex">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sidebar-accent text-sidebar-primary">
                  <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-white">{title}</span>
                  <span className="text-[13px] leading-relaxed text-sidebar-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden items-center gap-2 text-xs text-sidebar-muted sm:flex">
          <Lock className="size-3.5" strokeWidth={2} aria-hidden />
          Members see only their own giving and church totals. Nobody else&apos;s.
        </p>
      </section>

      {/* Form */}
      <section aria-labelledby="signin-title" className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div>
            <h2 id="signin-title" className="text-2xl font-semibold tracking-tight">
              Sign in
            </h2>
            <p className="mt-1 text-muted-foreground">Use the email your parish treasurer registered for you.</p>
          </div>
          <SignInForm />
          <Suspense fallback={null}>
            <DemoAccounts />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function DemoAccounts() {
  await connection();
  if (!devLoginEnabled()) return null;
  const users = await prisma.users.findMany({
    where: { is_active: true, email: { endsWith: "@example.test" } },
    select: { email: true, role: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });
  if (users.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
      <div>
        <h3 className="text-[13px] font-semibold">Demo accounts</h3>
        <p className="text-xs text-muted-foreground">Development only · synthetic data · no password needed</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {users.map((u) => (
          <form key={u.email} action={signInAsDemo}>
            <input type="hidden" name="email" value={u.email} />
            <button
              type="submit"
              className="flex min-h-11 w-full flex-col items-start justify-center rounded-[10px] border border-border bg-card px-3 py-1.5 text-left hover:bg-muted"
            >
              <span className="text-[13px] font-medium capitalize">{u.role}</span>
              <span className="text-xs text-muted-foreground">{u.email.replace("@example.test", "")}</span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
