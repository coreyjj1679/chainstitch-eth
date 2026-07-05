"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { cn } from "@/lib/utils";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Team-mode session controls: a standalone workspace-settings button next to
 * the account chip (who you are, sign out). Renders nothing in local mode
 * (no accounts to manage). One flex item, so headers can lay it out as a
 * single unit (a bare fragment would scatter in justify-between headers).
 */
export function AccountMenu() {
  const { data: me } = useMe();
  const pathname = usePathname();

  if (!me || me.mode !== "team") return null;
  const wallet = me.user.wallets[0];

  return (
    <div className="flex items-center gap-2">
      {/* Project-only members can't read the workspace roster (403). */}
      {me.role && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Workspace settings"
          title="Workspace settings"
          className={cn(
            pathname === "/settings"
              ? "bg-muted text-foreground"
              : "text-muted-foreground",
          )}
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <Settings />
        </Button>
      )}
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
    </div>
  );
}
