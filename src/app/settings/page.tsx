"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { ArrowLeft, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ROLES: Array<{ value: WorkspaceRole; label: string; hint: string }> = [
  { value: "viewer", label: "Viewer", hint: "read + run" },
  { value: "editor", label: "Editor", hint: "edit notebooks & contracts" },
  { value: "owner", label: "Owner", hint: "everything incl. members" },
];

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

/** Per-project grant chips on a person's row; owners can revoke each. */
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

/** A workspace member: role everywhere, plus any per-project raises. */
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
        </div>
        {wallet && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={wallet}>
            {wallet}
          </p>
        )}
        <GrantChips member={member} isOwner={isOwner} />
      </div>
      {isOwner ? (
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
      )}
    </div>
  );
}

/** A guest: no workspace role — access comes only from their project grants. */
function GuestRow({ member, isOwner }: { member: MemberInfo; isOwner: boolean }) {
  const wallet = member.wallets[0];
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <UserRound className="size-4 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">
          {wallet ? shortAddress(wallet) : member.name}
        </span>
        {wallet && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={wallet}>
            {wallet}
          </p>
        )}
        <GrantChips member={member} isOwner={isOwner} />
      </div>
    </div>
  );
}

/**
 * Owner-only invite form. Deliberately workspace-only: single-project access
 * ("guests") is granted from that project's Share button, so each surface
 * carries exactly one decision.
 */
function InviteForm() {
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");

  const invite = useMutation({
    mutationFn: () => api.workspace.createInvite(wallet.trim(), role, null),
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

  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-4">
      <Label htmlFor="invite-wallet">Invite a member by wallet address</Label>
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
      <p className="text-xs text-muted-foreground">
        Members get {ROLES.find((r) => r.value === role)?.hint} on{" "}
        <span className="font-medium">every project</span>. No email needed —
        the invite is claimed when that wallet signs in with Ethereum. To share
        a single project instead, use that project&apos;s{" "}
        <span className="font-medium">Share</span> button.
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

  const workspaceMembers = members.data?.filter((m) => m.role !== null) ?? [];
  const guests = members.data?.filter((m) => m.role === null) ?? [];
  const pending = invites.data?.filter((i) => i.status === "pending") ?? [];

  const count = (n: number | undefined, loaded: boolean) =>
    loaded ? ` (${n})` : "";

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
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/" />}
          >
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
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members" className="px-3">
                Members{count(workspaceMembers.length, !!members.data)}
              </TabsTrigger>
              <TabsTrigger value="guests" className="px-3">
                Guests{count(guests.length, !!members.data)}
              </TabsTrigger>
              {isOwner && (
                <TabsTrigger value="invites" className="px-3">
                  Invites{count(pending.length, !!invites.data)}
                </TabsTrigger>
              )}
            </TabsList>

            {/* Members: workspace-wide people — a role on every project. */}
            <TabsContent value="members" className="grid gap-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Members see <span className="font-medium">every project</span> in
                the workspace at their role — viewers read &amp; run, editors
                change content, owners administer everything.
              </p>
              {isOwner && <InviteForm />}
              <div className="grid gap-2">
                {members.isLoading && <Skeleton className="h-16" />}
                {workspaceMembers.map((m) => (
                  <MemberRow
                    key={m.userId}
                    member={m}
                    isOwner={!!isOwner}
                    isSelf={m.userId === me?.user.id}
                  />
                ))}
                {members.data && workspaceMembers.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    No members yet. Owners appear here after their first sign-in.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground/60">
                Wallets in <code className="rounded bg-muted px-1 font-mono">OWNER_WALLETS</code>{" "}
                become owners on sign-in regardless of this list. Removing a
                member locks them out immediately and revokes their project
                access too.
              </p>
            </TabsContent>

            {/* Guests: project-only people, managed from each project's Share. */}
            <TabsContent value="guests" className="grid gap-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Guests have access to{" "}
                <span className="font-medium">specific projects only</span> and
                see nothing else. To add one, open that project and use its{" "}
                <span className="font-medium">Share</span> button — this page is
                the workspace-wide overview.
              </p>
              <div className="grid gap-2">
                {members.isLoading && <Skeleton className="h-16" />}
                {guests.map((m) => (
                  <GuestRow key={m.userId} member={m} isOwner={!!isOwner} />
                ))}
                {members.data && guests.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    No guests. Share a single project — with a wallet or an
                    “anyone with the link” URL — from that project&apos;s Share
                    button.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* Invites: pending until the wallet's first sign-in. */}
            {isOwner && (
              <TabsContent value="invites" className="grid gap-4 pt-4">
                <p className="text-sm text-muted-foreground">
                  An invite is just a wallet address and a role — it&apos;s
                  claimed automatically the first time that wallet signs in.
                  Workspace invites come from the Members tab; project invites
                  from each project&apos;s Share button.
                </p>
                <div className="grid gap-2">
                  {invites.isLoading && <Skeleton className="h-12" />}
                  {pending.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="truncate font-mono text-sm"
                            title={inv.wallet}
                          >
                            {shortAddress(inv.wallet)}
                          </span>
                          <Badge
                            variant={inv.projectId ? "outline" : "secondary"}
                            className="text-[10px]"
                          >
                            {inv.projectId ? `“${inv.projectName}” only` : "whole workspace"}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          invited as {inv.role} — waiting for first sign-in
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
                  {invites.data && pending.length === 0 && (
                    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      Nothing pending. Invite a member from the Members tab, or
                      share a project from its Share button.
                    </p>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>
    </div>
  );
}
