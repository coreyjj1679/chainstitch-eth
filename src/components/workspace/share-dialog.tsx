"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { Globe, Share2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { Project, WorkspaceRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLES: Array<{ value: WorkspaceRole; label: string; hint: string }> = [
  { value: "viewer", label: "Viewer", hint: "read + run with their own wallet" },
  { value: "editor", label: "Editor", hint: "edit notebooks & contracts" },
  { value: "owner", label: "Owner", hint: "project settings & sharing too" },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Google-Docs-style share dialog for one project: invite a wallet with a
 * role, see who has access (and via what), revoke grants and pending
 * invites. Access is granted to the whole project — the unit a notebook's
 * contracts, RPC config and recipes live in.
 */
export function ShareProjectDialog({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("viewer");

  const access = useQuery({
    queryKey: ["projectAccess", project.id],
    queryFn: () => api.projects.access(project.id),
    enabled: open,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["projectAccess", project.id] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["invites"] });
  };

  const invite = useMutation({
    mutationFn: () => api.workspace.createInvite(wallet.trim(), role, project.id),
    onSuccess: (created) => {
      invalidate();
      setWallet("");
      toast.success(
        created.status === "accepted"
          ? "Access granted — that wallet already has an account here"
          : "Invited — they get access the first time they sign in",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.workspace.revokeInvite(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeGrant = useMutation({
    mutationFn: (id: string) => api.workspace.removeGrant(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  // Sharing is a team-mode concept, for this project's owners.
  if (me?.mode !== "team" || project.role !== "owner") return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Share2 data-icon="inline-start" />
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share “{project.name}”</DialogTitle>
          </DialogHeader>

          <div className="grid gap-2 rounded-lg border border-dashed p-3">
            <div className="flex gap-2">
              <Input
                className="font-mono"
                placeholder="0x… wallet address"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isAddress(wallet.trim())) invite.mutate();
                }}
              />
              <Select
                value={role}
                onValueChange={(v) => setRole((v as WorkspaceRole) ?? "viewer")}
              >
                <SelectTrigger className="h-9 w-28" size="sm">
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
              <Button
                disabled={!isAddress(wallet.trim()) || invite.isPending}
                onClick={() => invite.mutate()}
              >
                <UserPlus data-icon="inline-start" />
                Invite
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Grants access to this project only, claimed when that wallet signs
              in — no email needed. {ROLES.find((r) => r.value === role)?.hint}.
            </p>
          </div>

          <div className="grid gap-2">
            {access.data?.members.map((member) => {
              const memberWallet = member.wallets[0];
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-sm">
                        {memberWallet ? shortAddress(memberWallet) : member.name}
                      </span>
                      {member.userId === me?.user.id && (
                        <Badge variant="secondary" className="text-xs">
                          you
                        </Badge>
                      )}
                    </div>
                    {member.via === "workspace" && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="size-3" />
                        workspace member — has access to every project
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">
                    {member.role}
                  </Badge>
                  {member.grantId && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Revoke access"
                      title="Revoke this project access"
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${memberWallet ? shortAddress(memberWallet) : member.name} from "${project.name}"?`,
                          )
                        )
                          revokeGrant.mutate(member.grantId!);
                      }}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  )}
                </div>
              );
            })}

            {access.data?.invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm" title={inv.wallet}>
                    {shortAddress(inv.wallet)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    invited as {inv.role} — waiting for first sign-in
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Revoke invite"
                  title="Revoke invite"
                  onClick={() => revokeInvite.mutate(inv.id)}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground/70">
            Members run blocks from their own browser against this project&apos;s
            RPC, so the RPC URL is visible to everyone here. Workspace-wide
            membership is managed from the account menu instead.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
