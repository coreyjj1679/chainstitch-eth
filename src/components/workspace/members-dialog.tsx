"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe, useProjects } from "@/lib/hooks";
import type { MemberInfo, WorkspaceRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <Select value={value} onValueChange={(v) => onChange(v as WorkspaceRole)} disabled={disabled}>
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
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
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

export function MembersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const isOwner = me?.role === "owner";

  const members = useQuery({
    queryKey: ["members"],
    queryFn: api.workspace.members,
    enabled: open,
  });
  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: api.workspace.invites,
    enabled: open && isOwner,
  });
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
  const revoke = useMutation({
    mutationFn: (id: string) => api.workspace.revokeInvite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const scopeLabel =
    scope === WORKSPACE_SCOPE
      ? "the whole workspace"
      : `only “${projects?.find((p) => p.id === scope)?.name ?? "that project"}”`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workspace members</DialogTitle>
        </DialogHeader>

        {isOwner && (
          <div className="grid gap-2 rounded-lg border border-dashed p-3">
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
              No email needed — the invite is claimed when that wallet signs in
              with Ethereum. {ROLES.find((r) => r.value === role)?.hint}, in{" "}
              {scopeLabel}.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          {members.data?.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              isOwner={!!isOwner}
              isSelf={m.userId === me?.user.id}
            />
          ))}
          {members.data && members.data.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              No members yet. Owners appear here after their first sign-in.
            </p>
          )}
        </div>

        {isOwner && invites.data && invites.data.length > 0 && (
          <div className="grid gap-2">
            <Label>Pending invites</Label>
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
                    {inv.projectId ? ` on “${inv.projectName}”` : ""} — waiting for
                    first sign-in
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
