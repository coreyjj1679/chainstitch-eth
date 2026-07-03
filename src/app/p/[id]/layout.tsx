"use client";

import { use, type ReactNode } from "react";
import Link from "next/link";
import { useMe, useProject } from "@/lib/hooks";
import { ProjectWeb3Provider } from "@/components/wallet/project-web3-provider";
import { WalletButton } from "@/components/wallet/wallet-button";
import { ProjectSidebar } from "@/components/layout/project-sidebar";
import { ProjectSettingsDialog } from "@/components/layout/project-settings-dialog";
import { AccountMenu } from "@/components/workspace/account-menu";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: project, isLoading } = useProject(id);
  const { data: me } = useMe();
  const isOwner = me?.role === "owner";

  if (isLoading || !project) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <ProjectWeb3Provider project={project}>
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="shrink-0 border-b bg-background/80 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2">
            <Link href="/" className="flex items-center">
              <Logo size={22} />
            </Link>
            <span className="leading-none text-muted-foreground/40">/</span>
            {isOwner ? (
              <ProjectSettingsDialog project={project} />
            ) : (
              <span className="truncate px-1 text-sm leading-none font-medium">
                {project.name}
              </span>
            )}
            <Badge variant="secondary" className="font-mono text-xs">
              chain {project.chainId}
            </Badge>
            {project.description && (
              <span
                className="hidden max-w-64 truncate text-xs text-muted-foreground/70 lg:inline"
                title={project.description}
              >
                {project.description}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <WalletButton />
              <AccountMenu />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <ProjectSidebar projectId={id} />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="w-full max-w-7xl px-8 py-8">{children}</div>
          </main>
        </div>
      </div>
    </ProjectWeb3Provider>
  );
}
