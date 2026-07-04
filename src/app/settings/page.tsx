"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { ArrowLeft, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe, useProjects } from "@/lib/hooks";
import type { MemberInfo, WorkspaceRole } from "@/lib/types";
import { AccountMenu } from "@/components/workspace/account-menu";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ROLES: Array<{ value: WorkspaceRole; label: string; hint: string }> = [
  { value: "viewer", label: "Viewer", hint: "read + run" },
  { value: "editor", label: "Editor", hint: "edit notebooks & contracts" },
  { value: "owner", label: "Owner", hint: "everything incl. members" },
];

/** Sentinel for the scope select: an invite that grants the whole workspace. */
const WORKSPACE_SCOPE = "__workspace__";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      items={ROLES.map((r) => ({ value: r.value, label: r.label }))}
      onValueChange={(v) => onChange(v as WorkspaceRole)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 w-28 text-xs" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Per-project grant chips on a member row; owners can revoke each. */
function GrantChips({ member, isOwner }: { member: MemberInfo; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const removeGrant = useMutation({
    mutationFn: (id: string) => api.workspace.removeGrant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (member.grants.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {member.grants.map((grant) => (
        <Badge
          key={grant.id}
          variant="secondary"
          className="gap-1 pr-1 text-[10px] font-normal"
          title={`${grant.role} on ${grant.projectName}`}
        >
          {grant.projectName} · {grant.role}
          {isOwner && (
            <button
              type="button"
              aria-label={`Revoke access to ${grant.projectName}`}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              onClick={() => removeGrant.mutate(grant.id)}
            >
              <X className="size-2.5" />
            </button>
          )}
        </Badge>
      ))}
    </div>
  );
}

function MemberRow({
  member,
  isOwner,
  isSelf,
}: {
  member: MemberInfo;
  isOwner: boolean;
  isSelf: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const setRole = useMutation({
    mutationFn: (role: WorkspaceRole) => api.workspace.updateMemberRole(member.id!, role),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.workspace.removeMember(member.id!),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const wallet = member.wallets[0];
  const isWorkspaceMember = member.id !== null && member.role !== null;
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm">
            {wallet ? shortAddress(wallet) : member.name}
          </span>
          {isSelf && (
            <Badge variant="secondary" className="text-xs">
              you
            </Badge>
          )}
          {!isWorkspaceMember && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              project only
            </Badge>
          )}
        </div>
        {wallet && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={wallet}>
            {wallet}
          </p>
        )}
        <GrantChips member={member} isOwner={isOwner} />
      </div>
      {isWorkspaceMember ? (
        isOwner ? (
          <>
            <RoleSelect
              value={member.role!}
              onChange={(role) => setRole.mutate(role)}
              disabled={setRole.isPending}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove member"
              title="Remove from workspace (revokes project access too)"
              onClick={() => {
                if (confirm(`Remove ${wallet ? shortAddress(wallet) : member.name}?`))
                  remove.mutate();
              }}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          </>
        ) : (
          <Badge variant="outline" className="text-xs capitalize">
            {member.role}
          </Badge>
        )
      ) : null}
    </div>
  );
}

/** Owner-only invite form: wallet + role + scope (workspace or one project). */
function InviteForm() {
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [scope, setScope] = useState<string>(WORKSPACE_SCOPE);

  const invite = useMutation({
    mutationFn: () =>
      api.workspace.createInvite(
        wallet.trim(),
        role,
        scope === WORKSPACE_SCOPE ? null : scope,
      ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      setWallet("");
      toast.success(
        created.status === "accepted"
          ? "Added — that wallet already has an account here"
          : "Invited — they get access the first time they sign in",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scopeLabel =
    scope === WORKSPACE_SCOPE
      ? "the whole workspace"
      : `only “${projects?.find((p) => p.id === scope)?.name ?? "that project"}”`;

  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-4">
      <Label htmlFor="invite-wallet">Invite by wallet address</Label>
      <div className="flex gap-2">
        <Input
          id="invite-wallet"
          className="font-mono"
          placeholder="0x…"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isAddress(wallet.trim())) invite.mutate();
          }}
        />
        <RoleSelect value={role} onChange={setRole} />
        <Button
          disabled={!isAddress(wallet.trim()) || invite.isPending}
          onClick={() => invite.mutate()}
        >
          <UserPlus data-icon="inline-start" />
          Invite
        </Button>
      </div>
      <Select
        value={scope}
        items={[
          { value: WORKSPACE_SCOPE, label: "Whole workspace — every project" },
          ...(projects ?? []).map((p) => ({ value: p.id, label: `Only “${p.name}”` })),
        ]}
        onValueChange={(v) => setScope(v ?? WORKSPACE_SCOPE)}
      >
        <SelectTrigger className="h-7 w-full text-xs" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WORKSPACE_SCOPE}>
            Whole workspace — every project
          </SelectItem>
          {projects?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              Only “{p.name}”
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        No email needed — the invite is claimed when that wallet signs in with
        Ethereum. {ROLES.find((r) => r.value === role)?.hint}, in {scopeLabel}.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const isOwner = me?.role === "owner";
  const isTeam = me?.mode === "team";
  const isMember = !!me?.role;

  const members = useQuery({
    queryKey: ["members"],
    queryFn: api.workspace.members,
    enabled: isTeam && isMember,
  });
  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: api.workspace.invites,
    enabled: isTeam && !!isOwner,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.workspace.revokeInvite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-8 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center">
              <Logo size={22} />
            </Link>
            <span className="leading-none text-muted-foreground/40">/</span>
            <span className="text-sm font-medium">Settings</span>
          </div>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-8 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Workspace settings
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isTeam
                ? "Who can sign in, and what they can touch."
                : "Access management activates in team mode."}
            </p>
          </div>
          <Button variant="ghost" size="sm" render={<Link href="/" />}>
            <ArrowLeft data-icon="inline-start" />
            Back to projects
          </Button>
        </div>

        {meLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
          </div>
        ) : !isTeam ? (
          <div className="rounded-xl border border-dashed px-8 py-14 text-center">
            <p className="mb-1 font-medium">Local mode — no accounts</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              This instance runs without sign-in; everything belongs to you. To
              share it with a team, set <code className="rounded bg-muted px-1 font-mono">APP_MODE=team</code>{" "}
              (plus <code className="rounded bg-muted px-1 font-mono">OWNER_WALLETS</code>,{" "}
              <code className="rounded bg-muted px-1 font-mono">BETTER_AUTH_SECRET</code> and{" "}
              <code className="rounded bg-muted px-1 font-mono">APP_URL</code>) and restart —
              see the README&apos;s self-hosting section.
            </p>
          </div>
        ) : !isMember ? (
          <div className="rounded-xl border border-dashed px-8 py-14 text-center">
            <p className="mb-1 font-medium">Project access only</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              You have access to specific projects, but workspace settings are
              visible to workspace members only.
            </p>
          </div>
        ) : (
          <div className="grid gap-8">
            {isOwner && <InviteForm />}

            <section className="grid gap-2">
              <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Members
              </h2>
              {members.data?.map((m) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  isOwner={!!isOwner}
                  isSelf={m.userId === me?.user.id}
                />
              ))}
              {members.data && members.data.length === 0 && (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No members yet. Owners appear here after their first sign-in.
                </p>
              )}
            </section>

            {isOwner && invites.data && invites.data.length > 0 && (
              <section className="grid gap-2">
                <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                  Pending invites
                </h2>
                {invites.data.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm" title={inv.wallet}>
                        {shortAddress(inv.wallet)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        invited as {inv.role}
                        {inv.projectId ? ` on “${inv.projectName}”` : ""} — waiting
                        for first sign-in
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Revoke invite"
                      title="Revoke invite"
                      onClick={() => revoke.mutate(inv.id)}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </section>
            )}

            <p className="text-xs text-muted-foreground/60">
              Wallets in <code className="rounded bg-muted px-1 font-mono">OWNER_WALLETS</code>{" "}
              become owners on sign-in regardless of this list. Removing a member
              locks them out immediately and revokes their project access. Each
              project&apos;s Share button manages access to just that project.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
