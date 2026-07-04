"use client";

import Link from "next/link";
import { LogOut, Settings, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Team-mode session chip: who you are, workspace settings, sign out.
 * Renders nothing in local mode (no accounts to manage).
 */
export function AccountMenu() {
  const { data: me } = useMe();

  if (!me || me.mode !== "team") return null;
  const wallet = me.user.wallets[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="ghost" className="gap-2" title="Account" />
        }
      >
        <UserRound className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">
          {wallet ? shortAddress(wallet) : me.user.name}
        </span>
        {me.role && (
          <Badge variant="secondary" className="text-[10px] capitalize">
            {me.role}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {/* Project-only members can't read the workspace roster (403). */}
        {me.role && (
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings />
            Workspace settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/login";
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
