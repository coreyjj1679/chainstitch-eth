"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { ApiTokenInfo, MemberInfo, WorkspaceRole } from "@/lib/types";
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

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {member.grants.map((g) => (
        <Badge
          key={g.id}
          variant="outline"
          className="gap-1 font-normal text-[10px]"
        >
          {g.projectName}
          <span className="text-muted-foreground">· {g.role}</span>
          {isOwner && (
            <button
              type="button"
              className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={`Revoke access to ${g.projectName}`}
              onClick={() => removeGrant.mutate(g.id)}
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
  const updateRole = useMutation({
    mutationFn: (role: WorkspaceRole) =>
      api.workspace.updateMemberRole(member.id!, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.workspace.removeMember(member.id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <UserRound className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{member.name}</span>
          {isSelf && (
            <Badge variant="secondary" className="text-[10px]">
              you
            </Badge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {member.wallets[0] ? shortAddress(member.wallets[0]) : member.userId}
        </p>
        <GrantChips member={member} isOwner={isOwner} />
      </div>
      {isOwner ? (
        <div className="flex shrink-0 items-center gap-1">
          <RoleSelect
            value={member.role!}
            onChange={(role) => updateRole.mutate(role)}
            disabled={isSelf || updateRole.isPending}
          />
          {!isSelf && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove member"
              title="Remove member"
              onClick={() => remove.mutate()}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          )}
        </div>
      ) : (
        <Badge variant="secondary" className="shrink-0 capitalize">
          {member.role}
        </Badge>
      )}
    </div>
  );
}

function GuestRow({ member, isOwner }: { member: MemberInfo; isOwner: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <UserRound className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{member.name}</span>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {member.wallets[0] ? shortAddress(member.wallets[0]) : member.userId}
        </p>
        <GrantChips member={member} isOwner={isOwner} />
      </div>
    </div>
  );
}

function InviteForm() {
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const create = useMutation({
    mutationFn: () => api.workspace.createInvite(wallet.trim(), role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      setWallet("");
      toast.success("Invite created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = isAddress(wallet.trim());

  return (
    <div className="grid gap-3 rounded-xl border bg-card/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-wallet" className="text-xs">
            Wallet address
          </Label>
          <Input
            id="invite-wallet"
            placeholder="0x…"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Role</Label>
          <RoleSelect value={role} onChange={setRole} />
        </div>
        <Button
          size="sm"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
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

/** Personal API tokens for MCP agents — each token inherits the caller's roles. */
function AgentTokensPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: api.tokens.list,
  });

  const create = useMutation({
    mutationFn: () => api.tokens.create(name.trim() || "Agent token"),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
      setName("");
      setFresh(created.token);
      setCopied(false);
      toast.success("Token created — copy it now");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
      toast.success("Token revoked");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyToken(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy — select the token and copy manually");
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Use a token so coding agents can call this instance&apos;s{" "}
        <code className="rounded bg-muted px-1 font-mono text-[0.85em]">/api/mcp</code>{" "}
        without a wallet. Each token acts as{" "}
        <span className="font-medium">you</span> — same workspace and project
        roles. Put it in the agent&apos;s MCP config as{" "}
        <code className="rounded bg-muted px-1 font-mono text-[0.85em]">
          Authorization: Bearer cst_…
        </code>
        .
      </p>

      {fresh && (
        <div className="grid gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-3.5 text-primary" />
            Copy your token now — it won&apos;t be shown again
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 font-mono text-xs">
              {fresh}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copyToken(fresh)}
            >
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setFresh(null)}
          >
            Done
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="token-name" className="text-xs">
            Label
          </Label>
          <Input
            id="token-name"
            placeholder="Cursor on laptop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          <KeyRound data-icon="inline-start" />
          Create token
        </Button>
      </div>

      <div className="grid gap-2">
        {tokens.isLoading && <Skeleton className="h-14" />}
        {tokens.data?.map((t: ApiTokenInfo) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {t.tokenPrefix}…
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                created {formatWhen(t.createdAt)}
                {t.lastUsedAt ? ` · last used ${formatWhen(t.lastUsedAt)}` : ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Revoke ${t.name}`}
              title="Revoke token"
              onClick={() => revoke.mutate(t.id)}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          </div>
        ))}
        {tokens.data && tokens.data.length === 0 && !fresh && (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No tokens yet. Create one to connect Cursor, Claude Code, or another
            MCP client to this team instance.
          </p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const isOwner = me?.role === "owner";
  const isTeam = me?.mode === "team";
  const isMember = !!me?.role;
  const isSignedIn =
    isTeam &&
    !!me &&
    me.user.id !== "link-guest" &&
    (isMember || Object.keys(me.projectRoles).length > 0);

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
                ? "Who can sign in, agent tokens, and what they can touch."
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
              This instance runs without sign-in; everything belongs to you. MCP
              needs no token here. To share with a team, set{" "}
              <code className="rounded bg-muted px-1 font-mono">APP_MODE=team</code>{" "}
              (plus <code className="rounded bg-muted px-1 font-mono">OWNER_WALLETS</code>,{" "}
              <code className="rounded bg-muted px-1 font-mono">BETTER_AUTH_SECRET</code> and{" "}
              <code className="rounded bg-muted px-1 font-mono">APP_URL</code>) and restart —
              see the README&apos;s self-hosting section.
            </p>
          </div>
        ) : !isSignedIn ? (
          <div className="rounded-xl border border-dashed px-8 py-14 text-center">
            <p className="mb-1 font-medium">Sign in required</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Settings and agent tokens are available after you sign in with a
              wallet that has workspace or project access.
            </p>
          </div>
        ) : (
          <Tabs defaultValue={isMember ? "members" : "tokens"}>
            <TabsList>
              {isMember && (
                <TabsTrigger value="members" className="px-3">
                  Members{count(workspaceMembers.length, !!members.data)}
                </TabsTrigger>
              )}
              {isMember && (
                <TabsTrigger value="guests" className="px-3">
                  Guests{count(guests.length, !!members.data)}
                </TabsTrigger>
              )}
              {isOwner && (
                <TabsTrigger value="invites" className="px-3">
                  Invites{count(pending.length, !!invites.data)}
                </TabsTrigger>
              )}
              <TabsTrigger value="tokens" className="px-3">
                Agent tokens
              </TabsTrigger>
            </TabsList>

            {isMember && (
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
            )}

            {isMember && (
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
            )}

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

            <TabsContent value="tokens" className="pt-4">
              <AgentTokensPanel />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
