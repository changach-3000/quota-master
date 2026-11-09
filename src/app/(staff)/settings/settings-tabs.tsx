"use client";

import { ChangePasswordForm } from "@/components/app/change-password-form";
import { Field, inputClass, selectClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel, PanelHeader } from "@/components/dashboard/primitives";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { kshAmount } from "@/schemas/money";
import { churchSchema, periodSchema } from "@/schemas/settings";
import type { Role } from "@/services/viewer";
import { CalendarPlus, Church, Copy, DatabaseBackup, KeyRound, LoaderCircle, Lock, Mail, Plus, ShieldCheck, Timer, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { addChurchAction, addPeriodAction, inviteAction, resetAccessAction, saveQuotasAction, type InviteState } from "./actions";
import { toast } from "sonner";
import { z } from "zod";

type Period = { id: string; name: string; startsOn: string; endsOn: string };
type Setup = { periods: Period[]; churches: { id: string; name: string; members: number; quotas: Record<string, number> }[] };
type User = { id: string; email: string; role: Role; isActive: boolean; parishioner: string | null; invitePending: boolean; createdAt: string };

const ROLE_INFO: Record<Role, string> = {
  admin: "Everything, including users and settings",
  treasurer: "Records payments, deposits, pledges and imports",
  auditor: "Sees everything, changes nothing",
  member: "Their own giving and church totals only",
};

export function SettingsTabs({
  setup,
  users,
  unlinked,
  canEdit,
  isAdmin,
  viewerId,
}: {
  setup: Setup;
  users: User[];
  churches: { id: string; name: string }[];
  unlinked: { id: string; name: string; church: string }[];
  canEdit: boolean;
  isAdmin: boolean;
  viewerId: string;
}) {
  return (
    <Tabs defaultValue="parish" className="gap-5">
      <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-fit">
        <TabsTrigger value="parish" className="h-9 px-3 data-active:bg-card data-active:text-foreground data-active:shadow-sm">
          Churches &amp; quotas
        </TabsTrigger>
        <TabsTrigger value="periods" className="h-9 px-3 data-active:bg-card data-active:text-foreground data-active:shadow-sm">
          Periods
        </TabsTrigger>
        <TabsTrigger value="users" className="h-9 px-3 data-active:bg-card data-active:text-foreground data-active:shadow-sm">
          Users
        </TabsTrigger>
        <TabsTrigger value="security" className="h-9 px-3 data-active:bg-card data-active:text-foreground data-active:shadow-sm">
          Security
        </TabsTrigger>
      </TabsList>

      <TabsContent value="parish">
        <QuotasPanel setup={setup} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="periods">
        <PeriodsPanel periods={setup.periods} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="users">
        <UsersPanel users={users} canInvite={isAdmin} unlinked={unlinked} viewerId={viewerId} />
      </TabsContent>
      <TabsContent value="security" className="flex flex-col gap-4">
        <Panel className="flex max-w-xl flex-col gap-4 p-5">
          <PanelHeader id="own-password" title="Your password" description="Changing it signs you out on every other device." />
          <ChangePasswordForm />
        </Panel>
        <SecurityPanel />
      </TabsContent>
    </Tabs>
  );
}

function QuotasPanel({ setup, canEdit }: { setup: Setup; canEdit: boolean }) {
  const [periodId, setPeriodId] = useState(setup.periods[0]?.id ?? "");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const period = setup.periods.find((p) => p.id === periodId);
  const total = setup.churches.reduce((s, c) => s + (c.quotas[periodId] ?? 0), 0);

  const [saving, setSaving] = useState(false);

  async function save() {
    const next: Record<string, string> = {};
    for (const [id, v] of Object.entries(draft)) {
      const r = kshAmount.safeParse(v);
      if (!r.success) next[id] = r.error.issues[0]?.message ?? "Invalid amount";
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (Object.keys(draft).length === 0) return toast.info("No quotas changed");
    setSaving(true);
    try {
      const result = await saveQuotasAction({ periodId, quotas: Object.entries(draft).map(([churchId, amount]) => ({ churchId, amount })) });
      if (result.ok) {
        setDraft({});
        toast.success(result.changed ? `${period?.name} quotas saved` : "No quotas changed", {
          description: result.changed ? `${result.changed} church${result.changed === 1 ? "" : "es"} updated. Each change is in the audit log.` : undefined,
        });
      } else {
        toast.error("Quotas not saved", { description: result.message ?? Object.values(result.fieldErrors ?? {}).find(Boolean) });
      }
    } catch {
      toast.error("Couldn't reach the server", { description: "Nothing was saved. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <PanelHeader
        id="quotas-title"
        title="Church quotas"
        description="What each church is asked to raise in a period."
        action={
          <div className="flex flex-wrap gap-2">
            <label htmlFor="quota-period" className="sr-only">
              Period
            </label>
            <select
              id="quota-period"
              value={periodId}
              onChange={(e) => {
                setPeriodId(e.target.value);
                setDraft({});
                setErrors({});
              }} className={cn(selectClass, "h-10 w-auto")}>
              {setup.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {canEdit && <AddChurchButton />}
          </div>
        }
      />
      <Table className="min-w-[520px] text-[13px]">
        <TableHeader>
          <TableRow className="bg-background hover:bg-background">
            <TableHead className="font-medium text-muted-foreground">Church</TableHead>
            <TableHead className="text-right font-medium text-muted-foreground">Active members</TableHead>
            <TableHead className="w-56 text-right font-medium text-muted-foreground">{period?.name} quota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {setup.churches.map((c) => (
            <TableRow key={c.id} className="border-slate-100">
              <TableCell className="py-3 font-medium">
                <span className="inline-flex items-center gap-2">
                  <Church className="size-4 text-muted-foreground" aria-hidden />
                  {c.name}
                </span>
              </TableCell>
              <TableCell className="py-3 text-right tabular">{c.members}</TableCell>
              <TableCell className="py-2 text-right">
                {canEdit ? (
                  <div className="flex flex-col items-end gap-1">
                    <label htmlFor={`quota-${c.id}`} className="sr-only">
                      {c.name} quota in KSh
                    </label>
                    <input
                      id={`quota-${c.id}`}
                      inputMode="decimal"
                      defaultValue={((c.quotas[periodId] ?? 0) / 100).toLocaleString("en-KE")}
                      key={periodId}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      className={cn(inputClass, "h-10 w-44 text-right tabular")}
                      aria-invalid={!!errors[c.id]}
                    />
                    {errors[c.id] && <span className="text-xs text-negative">{errors[c.id]}</span>}
                  </div>
                ) : (
                  <span className="tabular">{formatKsh(c.quotas[periodId] ?? 0)}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[13px]">
        <span className="tabular">
          Parish total <strong>{formatKsh(total)}</strong>
        </span>
        {canEdit && (
          <button type="button" onClick={save} disabled={saving} className={buttonClass("primary")}>
            {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {saving ? "Saving…" : "Save quotas"}
          </button>
        )}
      </div>
    </Panel>
  );
}

function AddChurchButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass("secondary")}>
        <Plus className="size-4" aria-hidden />
        Add church
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            const parsed = churchSchema.safeParse({ name });
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            const result = await addChurchAction({ name });
            if (!result.ok) return setError(result.fieldErrors?.name ?? result.message ?? "Not saved");
            setError(undefined);
            setOpen(false);
            toast.success(`${name} added`, { description: "Set its quota for each period below." });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add church</DialogTitle>
            <DialogDescription>Set its quota afterwards for each period.</DialogDescription>
          </DialogHeader>
          <Field id="church-name" label="Name" error={error}>
            <input id="church-name" name="name" className={inputClass} aria-invalid={!!error} />
          </Field>
          <DialogFooter>
            <DialogClose className={buttonClass("secondary")}>Cancel</DialogClose>
            <button type="submit" className={buttonClass("primary")}>
              Add church
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeriodsPanel({ periods, canEdit }: { periods: Period[]; canEdit: boolean }) {
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Panel className="min-w-0 flex-[2_1_420px] overflow-hidden">
        <div className="px-5 py-[18px]">
          <PanelHeader id="periods-title" title="Quota periods" description="Periods can't overlap. The database enforces this." />
        </div>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="border-t border-border bg-background hover:bg-background">
              <TableHead className="pl-5 font-medium text-muted-foreground">Name</TableHead>
              <TableHead className="font-medium text-muted-foreground">Starts</TableHead>
              <TableHead className="pr-5 font-medium text-muted-foreground">Ends</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => (
              <TableRow key={p.id} className="border-slate-100">
                <TableCell className="py-3 pl-5 font-medium">{p.name}</TableCell>
                <TableCell className="py-3 tabular">{formatDate(p.startsOn)}</TableCell>
                <TableCell className="py-3 pr-5 tabular">{formatDate(p.endsOn)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      {canEdit && (
        <Panel className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-5">
          <h2 className="text-base font-semibold">New period</h2>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const parsed = periodSchema.safeParse(Object.fromEntries(new FormData(form)));
              if (!parsed.success) {
                const fe = z.flattenError(parsed.error).fieldErrors;
                return setErrors({ name: fe.name?.[0], startsOn: fe.startsOn?.[0], endsOn: fe.endsOn?.[0] });
              }
              const v = parsed.data;
              const clash = periods.find((p) => v.startsOn <= p.endsOn && p.startsOn <= v.endsOn);
              if (clash) return setErrors({ startsOn: `Overlaps the ${clash.name} period (${formatDate(clash.startsOn)} – ${formatDate(clash.endsOn)})` });
              const result = await addPeriodAction({ name: v.name, startsOn: v.startsOn, endsOn: v.endsOn });
              if (!result.ok) return setErrors(result.fieldErrors ?? { name: result.message });
              setErrors({});
              form.reset();
              toast.success(`The ${v.name} period was added`, { description: "Set each church's quota for it in Churches & quotas." });
            }}
          >
            <Field id="period-name" label="Name" error={errors.name}>
              <input id="period-name" name="name" placeholder="2027" className={inputClass} aria-invalid={!!errors.name} />
            </Field>
            <Field id="period-start" label="Starts on" error={errors.startsOn}>
              <input id="period-start" name="startsOn" type="date" className={inputClass} aria-invalid={!!errors.startsOn} />
            </Field>
            <Field id="period-end" label="Ends on" error={errors.endsOn}>
              <input id="period-end" name="endsOn" type="date" className={inputClass} aria-invalid={!!errors.endsOn} />
            </Field>
            <button type="submit" className={buttonClass("primary")}>
              <CalendarPlus className="size-4" aria-hidden />
              Add period
            </button>
          </form>
        </Panel>
      )}
    </div>
  );
}

function UsersPanel({
  users,
  canInvite,
  unlinked,
  viewerId,
}: {
  users: User[];
  canInvite: boolean;
  unlinked: { id: string; name: string; church: string }[];
  viewerId: string;
}) {
  const [role, setRole] = useState<Role>("member");
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const [reset, setReset] = useState<{ email: string; link?: string; error?: string } | null>(null);

  async function issueReset(u: User) {
    const result = await resetAccessAction(u.id);
    setReset({ email: u.email, ...result });
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Panel className="min-w-0 flex-[2_1_520px] overflow-hidden">
        <div className="px-5 py-[18px]">
          <PanelHeader id="users-title" title="People who can sign in" description="Roles decide what each person can see and do." />
        </div>
        {reset && (
          <div className="mx-5 mb-4">
            {reset.link ? (
              <OneTimeLink title={`Reset link for ${reset.email}`} path={reset.link} note="Valid for 24 hours. They have been signed out everywhere." />
            ) : (
              <p role="alert" className="text-[13px] font-medium text-negative">
                {reset.error}
              </p>
            )}
          </div>
        )}
        <Table className="min-w-[620px] text-[13px]">
          <TableHeader>
            <TableRow className="border-t border-border bg-background hover:bg-background">
              <TableHead className="pl-5 font-medium text-muted-foreground">Email</TableHead>
              <TableHead className="font-medium text-muted-foreground">Role</TableHead>
              <TableHead className="font-medium text-muted-foreground">Linked to</TableHead>
              <TableHead className="font-medium text-muted-foreground">Status</TableHead>
              {canInvite && (
                <TableHead className="pr-5">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className="border-slate-100">
                <TableCell className="py-3 pl-5 font-medium">{u.email}</TableCell>
                <TableCell className="py-3 capitalize">{u.role}</TableCell>
                <TableCell className="py-3 text-slate-600">{u.parishioner ?? "—"}</TableCell>
                <TableCell className="py-3">
                  {!u.isActive ? (
                    <span className="text-muted-foreground">Disabled</span>
                  ) : u.invitePending ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-text">
                      <Mail className="size-3" aria-hidden /> Invite pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-positive-soft px-2 py-0.5 text-xs font-medium text-positive-text">
                      <ShieldCheck className="size-3" aria-hidden /> Active
                    </span>
                  )}
                </TableCell>
                {canInvite && (
                  <TableCell className="py-3 pr-5 text-right">
                    {u.id !== viewerId && u.isActive && (
                      <button
                        type="button"
                        onClick={() => issueReset(u)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-primary hover:bg-positive-soft"
                      >
                        <KeyRound className="size-3.5" aria-hidden />
                        {u.invitePending ? "New invite link" : "Reset access"}
                      </button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <Panel className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-5">
        <h2 className="text-base font-semibold">Invite someone</h2>
        {!canInvite ? (
          <p className="text-[13px] text-muted-foreground">Only an admin can invite people or change roles.</p>
        ) : (
          <form action={action} noValidate className="flex flex-col gap-4">
            {state.error && (
              <p role="alert" className="text-[13px] font-medium text-negative">
                {state.error}
              </p>
            )}
            {state.link && (
              <OneTimeLink title={`Invite for ${state.email}`} path={state.link} note="Valid for 7 days and works once. Send it to them privately." />
            )}
            <Field id="invite-email" label="Email" error={state.fieldErrors?.email}>
              <input id="invite-email" name="email" type="email" className={inputClass} aria-invalid={!!state.fieldErrors?.email} />
            </Field>
            <Field id="invite-role" label="Role" hint={ROLE_INFO[role]}>
              <select id="invite-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
                <option value="member">Member</option>
                <option value="treasurer">Treasurer</option>
                <option value="auditor">Auditor</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            {role === "member" && (
              <Field id="invite-parishioner" label="Parishioner record" error={state.fieldErrors?.parishionerId} hint="Only people without a login are listed.">
                <select id="invite-parishioner" name="parishionerId" defaultValue="" className={selectClass} aria-invalid={!!state.fieldErrors?.parishionerId}>
                  <option value="" disabled>
                    Choose a parishioner
                  </option>
                  {unlinked.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.church}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              <UserPlus className="size-4" aria-hidden />
              Create invite link
            </button>
          </form>
        )}
      </Panel>
    </div>
  );
}

/** Shows a one-time link once, with copy. It can't be shown again later: only its hash is stored. */
function OneTimeLink({ title, path, note }: { title: string; path: string; note: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-green-200 bg-positive-soft p-3">
      <span className="text-[13px] font-medium text-positive-text">{title}</span>
      <div className="flex gap-2">
        <label htmlFor={`link-${path.slice(-8)}`} className="sr-only">
          {title}
        </label>
        <input id={`link-${path.slice(-8)}`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={cn(inputClass, "h-10 font-mono text-xs")} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
          className={buttonClass("secondary", "shrink-0")}
        >
          <Copy className="size-4" aria-hidden />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <span className="text-xs text-slate-600">{note} It won&apos;t be shown again.</span>
    </div>
  );
}

function SecurityPanel() {
  const items = [
    { icon: KeyRound, title: "Passwords", body: "Hashed with Argon2id. At least 12 characters; the most common choices are refused.", status: "On", ready: true },
    { icon: Timer, title: "Lockout", body: "Five wrong passwords lock sign-in for that email for 15 minutes; repeated failures from one network are rate-limited.", status: "On", ready: true },
    { icon: ShieldCheck, title: "Two-step sign-in", body: "Required for admins and treasurers before real parish money is recorded.", status: "Planned", ready: false },
    { icon: Lock, title: "Append-only ledger", body: "Payments and the audit log can't be edited or deleted, enforced by the database itself.", status: "On", ready: true },
    { icon: DatabaseBackup, title: "Backups", body: "Encrypted nightly backups with a tested restore. Not approved for real money until a restore drill passes.", status: "Planned", ready: false },
  ];
  return (
    <Panel className="flex flex-col gap-1 p-5">
      <PanelHeader id="security-title" title="Security" description="What protects the parish's records. Planned items arrive with the backend." />
      <ul className="mt-3 flex flex-col">
        {items.map(({ icon: Icon, title, body, status, ready }, i) => (
          <li key={title} className={cn("flex items-start gap-3 py-3.5", i > 0 && "border-t border-slate-100")}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-slate-600">
              <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="flex grow flex-col">
              <span className="font-medium">{title}</span>
              <span className="text-[13px] text-muted-foreground">{body}</span>
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                ready ? "border-green-200 bg-positive-soft text-positive-text" : "border-slate-200 bg-muted text-slate-600",
              )}
            >
              {status}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
