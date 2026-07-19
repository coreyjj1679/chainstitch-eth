import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookMarked,
  Bot,
  Code2,
  FlaskConical,
  Laptop,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { GithubIcon } from "@/components/github-link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Marketing page for signed-out visitors in team mode (the hosted instance).
 * Server-rendered and static — interactivity lives behind Sign in / the demo
 * share link. CTAs are env-driven so the same build serves any deployment:
 * DEMO_SHARE_URL (an "anyone with the link" project URL) and GITHUB_URL.
 */
export function LandingPage({
  demoUrl,
  githubUrl,
}: {
  demoUrl?: string;
  githubUrl?: string;
}) {
  const features = [
    {
      icon: Play,
      tint: "bg-emerald-400/10 text-emerald-400",
      title: "Chained like Jupyter cells",
      body: "Run blocks top to bottom; save any output as a {{variable}} and feed it into the next call. Multi-step DeFi flows stay readable — approve → deposit → check balance.",
    },
    {
      icon: FlaskConical,
      tint: "bg-sky-400/10 text-sky-400",
      title: "Simulate as anyone",
      body: "Dry-run entire notebooks as any address via eth_call — revert reasons and decoded call traces surface before anything is sent. On anvil forks, impersonate whales with no keys at all.",
    },
    {
      icon: Code2,
      tint: "bg-violet-400/10 text-violet-400",
      title: "Codegen for the handoff",
      body: "Every block emits its wagmi, viem, web3.py, alloy or Solidity snippet. The notebook is the integration spec — and it can't drift, because you just ran it.",
    },
    {
      icon: Sparkles,
      tint: "bg-amber-400/10 text-amber-400",
      title: "AI import from Foundry tests",
      body: "Paste a .t.sol file and it converts into runnable blocks — pranks become sender groups, cheatcodes become RPC cells, asserts become checks. Bring your own free Gemini key.",
    },
    {
      icon: BookMarked,
      tint: "bg-cyan-400/10 text-cyan-400",
      title: "Recipes & live state",
      body: "Save any flow as a reusable recipe and rerun it as one cell in any notebook. Pin view functions to a live per-contract dashboard, refreshed in one multicall.",
    },
    {
      icon: Users,
      tint: "bg-rose-400/10 text-rose-400",
      title: "Team-ready sharing",
      body: "Sign-In with Ethereum, invite by wallet address, viewer/editor/owner roles, per-project guests, and “anyone with the link” URLs — no email server to run.",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Logo size={24} />
          <div className="flex items-center gap-2">
            <Link
              href="/docs"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground",
              )}
            >
              Docs
            </Link>
            {githubUrl && (
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <GithubIcon className="size-4" data-icon="inline-start" />
                GitHub
              </a>
            )}
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-6 pt-16 pb-12">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border px-2.5 py-0.5">Open source · MIT</span>
              <span className="rounded-full border px-2.5 py-0.5">
                Local-first — keys never leave your browser
              </span>
              <span className="rounded-full border border-primary/40 px-2.5 py-0.5 text-primary">
                MCP server built in
              </span>
            </div>
            <h1 className="mb-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Runnable notebooks for
              <br />
              <span className="text-primary">smart contract handoff</span>
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
              Compose reads, writes and raw RPC calls into notebooks that run
              like Jupyter cells — chained with{" "}
              <code className="rounded bg-muted px-1 font-mono text-[0.85em]">
                {"{{variables}}"}
              </code>
              , simulated before anything is sent, and shared with your team as
              a single source of truth. Every block generates the exact
              wagmi/viem code your app can ship — and every instance is
              an MCP server your coding agent can drive.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {demoUrl && (
                <a href={demoUrl} className={cn(buttonVariants({ size: "lg" }))}>
                  Try the live demo
                  <ArrowRight data-icon="inline-end" />
                </a>
              )}
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: demoUrl ? "outline" : "default", size: "lg" }),
                )}
              >
                Sign in with Ethereum
              </Link>
              <a
                href="#self-host"
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
              >
                Self-host it
              </a>
            </div>
            {demoUrl && (
              <p className="mt-3 text-xs text-muted-foreground/70">
                No signup — the demo opens a real project on a mainnet fork.
              </p>
            )}
          </div>

          {/* Demo capscreen */}
          <div className="mx-auto mt-12 max-w-4xl">
            {/* Plain <img>: static marketing image from the seeded demo notebook. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/landing/codegen-source.png"
              alt="Chainstitch capscreen of the seeded Uniswap V3 and Chainlink example notebook, with chained variables and generated code"
              className="w-full rounded-xl border shadow-2xl"
            />
            <p className="mt-3 text-center text-xs text-muted-foreground/70">
              Capscreen from the same seeded example notebook (no wallet
              needed): deriving the Uniswap V3 USDC/WETH pool from its
              factory, reading pool state and the Chainlink ETH/USD price —
              chained with{" "}
              <code className="rounded bg-muted px-1 font-mono">{"{{usdc}}"}</code>{" "}
              / <code className="rounded bg-muted px-1 font-mono">{"{{pool}}"}</code>{" "}
              against Ethereum mainnet.
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="border-t bg-card/20">
          <div className="mx-auto w-full max-w-6xl px-6 py-14">
            <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
              Everything that touches a contract, in one document
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-xl border bg-card/40 p-5">
                  <div
                    className={cn(
                      "mb-3 flex size-8 items-center justify-center rounded-lg border",
                      f.tint,
                    )}
                  >
                    <f.icon className="size-4" />
                  </div>
                  <p className="mb-1.5 text-sm font-medium">{f.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modes */}
        <section className="border-t">
          <div className="mx-auto w-full max-w-6xl px-6 py-14">
            <h2 className="mb-2 text-center text-2xl font-semibold tracking-tight">
              Two modes, one env var apart
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-center text-sm text-muted-foreground">
              The same codebase and the same database serve a private
              single-user tool and an invite-only team instance.
            </p>
            <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-card/40 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg border bg-emerald-400/10 text-emerald-400">
                    <Laptop className="size-4" />
                  </div>
                  <p className="text-sm font-medium">
                    Local <span className="text-muted-foreground/60">(default)</span>
                  </p>
                </div>
                <ul className="grid gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>No login, no accounts — clone it and run it</li>
                  <li>
                    Everything in one SQLite file on your machine; no telemetry,
                    nothing phones home
                  </li>
                  <li>
                    <code className="rounded bg-muted px-1 font-mono">
                      npm install && npm run dev
                    </code>{" "}
                    is the whole setup
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border bg-card/40 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg border bg-sky-400/10 text-sky-400">
                    <Users className="size-4" />
                  </div>
                  <p className="text-sm font-medium">
                    Team <span className="text-muted-foreground/60">(APP_MODE=team)</span>
                  </p>
                </div>
                <ul className="grid gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>Sign-In with Ethereum — identity is the wallet, no email server</li>
                  <li>
                    Invite-only: wallets get viewer / editor / owner roles,
                    workspace-wide or per project
                  </li>
                  <li>
                    Google-Docs-style Share on every project, plus
                    “anyone with the link” URLs
                  </li>
                </ul>
              </div>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground/70">
              Switching modes keeps all your data —{" "}
              <Link href="/docs#team-mode" className="underline hover:text-foreground">
                how to self-host
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Codegen */}
        <section className="border-t">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-2xl font-semibold tracking-tight">
                The notebook <span className="text-primary">is</span> the
                integration doc
              </h2>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                Prove the flow works by running it, then flip the code toggle
                and copy the exact wagmi hooks or viem calls — ABIs and
                addresses included from the project&apos;s address book. The
                handoff document stops drifting because it is the same
                artifact you just executed.
              </p>
              <ul className="grid gap-2 text-sm text-muted-foreground">
                {[
                  "Per-block or whole-notebook source, in five flavors",
                  "Export any notebook as a JSON call manifest",
                  "Recipes turn multi-step flows into one reusable cell",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/landing/codegen-source.png"
              alt="A read block with its source toggle open, showing the generated wagmi useReadContract hook"
              className="w-full rounded-xl border"
            />
          </div>
        </section>

        {/* MCP */}
        <section className="border-t bg-card/20">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-2">
            <div className="order-last lg:order-first">
              <pre className="overflow-x-auto rounded-xl border bg-background px-5 py-4 font-mono text-xs leading-relaxed text-foreground/90">
                {`// .cursor/mcp.json — local mode
{
  "mcpServers": {
    "chainstitch": { "url": "http://localhost:3000/api/mcp" }
  }
}

// team mode — Settings → Agent tokens
{
  "mcpServers": {
    "chainstitch": {
      "url": "https://your-instance/api/mcp",
      "headers": { "Authorization": "Bearer cst_…" }
    }
  }
}

> "Make a notebook that checks the vault's allowance
>  and deposits 100 USDC if it's approved."

⏺ create_notebook … ✓ 6 blocks
  http://localhost:3000/p/…/n/…   ← open, hit Run all`}
              </pre>
              <p className="mt-3 text-center text-xs text-muted-foreground/70">
                Tools include <code className="rounded bg-muted px-1 font-mono">create_notebook</code>,{" "}
                <code className="rounded bg-muted px-1 font-mono">get_notebook_code</code>,{" "}
                <code className="rounded bg-muted px-1 font-mono">add_contract</code> — verified
                ABIs fetched by address.
              </p>
            </div>
            <div>
              <div className="mb-3 flex size-8 items-center justify-center rounded-lg border bg-primary/10 text-primary">
                <Bot className="size-4" />
              </div>
              <h2 className="mb-3 text-2xl font-semibold tracking-tight">
                Your coding agent <span className="text-primary">speaks Chainstitch</span>
              </h2>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                Every instance is an <strong className="text-foreground">MCP server</strong> —
                connect Cursor, Claude Code or any MCP-capable agent to{" "}
                <code className="rounded bg-muted px-1 font-mono text-[0.85em]">/api/mcp</code>{" "}
                and prompts become notebooks: the agent reads the repo it
                already sits in, assembles the blocks, adds missing ABIs, and
                hands back a URL to run. Ask for the reverse and any tested
                notebook comes out as wagmi, viem, Python or Rust source.
                Local mode needs no credentials; team mode uses a personal
                API token from Settings.
              </p>
              <ul className="grid gap-2 text-sm text-muted-foreground">
                {[
                  "No extra process — local needs no key; team mode uses a revocable Bearer token",
                  "Agents write definitions; execution stays in your browser, writes stay signed by your wallet",
                  "Notebooks travel as files too: versioned JSON import/export for PR review",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section className="border-t bg-card/20">
          <div className="mx-auto w-full max-w-6xl px-6 py-14">
            <h2 className="mb-2 text-center text-2xl font-semibold tracking-tight">
              Coming soon
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-center text-sm text-muted-foreground">
              Chainstitch is young and moving fast — this is what&apos;s on the
              bench next.
            </p>
            <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: "MCP flow-authoring pack",
                  body: "Templates and stronger agent instructions so deposit/withdraw/… notebooks consistently include expect-event and handoff-friendly variables.",
                },
                {
                  title: "MCP execution tools",
                  body: "Agents can simulate or fork-run a notebook and get receipts back over MCP before sharing with the team.",
                },
                {
                  title: "Deploy blocks",
                  body: "Deploy from a Foundry/Hardhat artifact; the new address becomes a variable and an address-book entry.",
                },
                {
                  title: "Safe Transaction Builder export",
                  body: "Export any flow as a Safe batch — an executable multisig runbook for ops.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-dashed bg-card/30 p-4">
                  <p className="mb-1 text-sm font-medium text-foreground/90">
                    {item.title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Self-host */}
        <section id="self-host" className="border-t">
          <div className="mx-auto w-full max-w-3xl px-6 py-14 text-center">
            <h2 className="mb-3 text-2xl font-semibold tracking-tight">
              Own everything
            </h2>
            <p className="mx-auto mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              One SQLite file on your machine. No accounts, no telemetry,
              nothing phones home. Private keys never touch the server — writes
              are signed in your browser wallet, reads run straight against
              your RPC.
            </p>
            <pre className="mx-auto mb-4 w-fit rounded-xl border bg-background px-6 py-4 text-left font-mono text-sm text-foreground/90">
              {"npm install && npm run dev   # that's it — SQLite bootstraps itself"}
            </pre>
            <p className="text-xs text-muted-foreground/70">
              Step-by-step Docker and team-mode guides live in{" "}
              <Link href="/docs#team-mode" className="underline hover:text-foreground">
                the docs
              </Link>
              {githubUrl ? (
                <>
                  {" "}and the{" "}
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    README on GitHub
                  </a>
                </>
              ) : null}
              .
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs text-muted-foreground/60">
          <span>MIT licensed · smart contract collaboration tools</span>
          <span className="flex items-center gap-4">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            {githubUrl && (
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                GitHub
                <ArrowUpRight className="size-3" />
              </a>
            )}
            <span className="font-mono">privacy by construction</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
