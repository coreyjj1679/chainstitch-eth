import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { GITHUB_URL } from "@/lib/site";
import { GithubLink } from "@/components/github-link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Docs — Chainstitch",
  description:
    "How to use and self-host Chainstitch: notebooks, blocks, variables, recipes, the address book, anvil workflows, and team mode.",
};

const TOC = [
  ["quick-start", "Quick start"],
  ["projects", "Projects & contracts"],
  ["notebooks", "Notebooks & blocks"],
  ["recipes", "Recipes"],
  ["state", "State tab"],
  ["codegen", "Codegen & AI import"],
  ["anvil", "Local chains & forks"],
  ["team-mode", "Team mode & self-hosting"],
  ["operations", "Operations"],
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 border-b pb-2 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="grid gap-3 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground/90">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border bg-card/40 px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90">
      {children}
    </pre>
  );
}

function DocsTable({
  head,
  rows,
}: {
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b bg-card/40">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className={i > 0 ? "border-t" : ""}>
              {cells.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3 py-2 align-top",
                    j === 0 ? "font-medium whitespace-nowrap text-foreground" : "",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Public, static documentation: how to use the product and how to self-host
 * it. Kept deliberately compact — the README on GitHub stays the canonical
 * deep-dive; this page is the in-product orientation.
 */
export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center">
              <Logo size={22} />
            </Link>
            <span className="leading-none text-muted-foreground/40">/</span>
            <span className="text-sm font-medium">Docs</span>
          </div>
          <div className="flex items-center gap-2">
            <GithubLink />
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Open the app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">
          Using &amp; hosting Chainstitch
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Everything you need to go from <Code>git clone</Code> to a running
          notebook — and from your laptop to a team instance. The{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            README on GitHub
          </a>{" "}
          stays the full reference.
        </p>

        {/* TOC */}
        <nav className="mb-10 flex flex-wrap gap-1.5">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="grid gap-10">
          <Section id="quick-start" title="Quick start">
            <Pre>{"npm install\nnpm run dev"}</Pre>
            <p>
              Open <Code>http://localhost:3000</Code> and create a project —
              there&apos;s an Anvil preset for local chains, or point it at any
              RPC. The SQLite database creates and migrates itself; there is no
              other setup. Every new project seeds a{" "}
              <strong>Welcome notebook</strong>: a runnable tour of blocks,
              variables, conditions and recipes that works against any RPC with
              no contracts and no wallet. Delete it when you&apos;re done.
            </p>
            <p>
              A wallet is only needed for <strong>write</strong> blocks.
              Injected wallets (MetaMask, Rabby, …) work out of the box; for
              WalletConnect set <Code>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</Code>{" "}
              (see <Code>.env.example</Code>). Reads and RPC calls run without
              any wallet, straight from your browser.
            </p>
          </Section>

          <Section id="projects" title="Projects & contracts">
            <p>
              A <strong>project</strong> is one chain config: chain id, RPC URL
              and optional block explorer. Its <strong>Contracts</strong> tab is
              the address book every notebook, codegen flavor and State card
              reads from.
            </p>
            <p>
              Add contracts by <strong>fetching a verified ABI</strong> — paste
              an address and the lookup queries Sourcify and Blockscout
              (Etherscan too when the server sets{" "}
              <Code>ETHERSCAN_API_KEY</Code>; a free key covers 60+ chains) — or
              by dropping <strong>ABI JSON files</strong> (raw arrays or
              Foundry/Hardhat artifacts). Proxies are handled automatically on
              lookup: the implementation ABI is paired with the proxy address,
              via explorer hints or an EIP-1967 slot read. On an anvil fork,
              pick the chain the fork is based on in the lookup&apos;s chain
              select.
            </p>
          </Section>

          <Section id="notebooks" title="Notebooks & blocks">
            <p>
              Notebooks run like Jupyter: per-block or top-to-bottom, with
              outputs decoded and saved. Name a block&apos;s output and
              reference it downstream as <Code>{"{{pool}}"}</Code> or{" "}
              <Code>{"{{receipt.blockNumber}}"}</Code> — dot/bracket paths reach
              into structured results.
            </p>
            <DocsTable
              head={["Block", "What it does"]}
              rows={[
                ["Read", "Calls a view/pure function from the address book, args from a typed form."],
                ["Write", "Simulates first — revert reasons surface before the wallet prompt — then sends and awaits the receipt."],
                ["RPC", "getBlock, getBalance, getLogs, … plus a raw custom-method escape hatch for anvil cheatcodes."],
                ["Text / Variable", "Markdown notes, and named constants usable as {{chips}} anywhere."],
                ["Sender group", "Runs child blocks as a chosen caller (impersonation on anvil needs no keys)."],
                ["If group / run-when", "Blocks run only when a condition on prior outputs holds ({{allowance}} < {{amount}})."],
                ["Recipe cell", "Reruns a saved recipe's steps in one click — see below."],
              ]}
            />
            <p>
              Keyboard shortcuts follow Jupyter: <Code>B</Code> adds a block,{" "}
              <Code>M</Code> a markdown cell, <Code>Shift+Enter</Code> runs and
              advances, <Code>Cmd+Enter</Code> runs in place. Notebooks and
              recipes open in browser-style tabs above the editor; each
              project&apos;s Overview page manages its documents.
            </p>
          </Section>

          <Section id="recipes" title="Recipes">
            <p>
              Select blocks in any notebook and bookmark them as a named{" "}
              <strong>recipe</strong> — the classic is{" "}
              <em>check the allowance, approve only if it&apos;s too low</em>.
              Insert one from the add-block menu either as a linked{" "}
              <strong>recipe cell</strong> (one click reruns every step; cells
              follow when the recipe is edited) or as editable blocks. Recipes
              live in the sidebar under your notebooks and open in the same
              editor: tweak steps with the full typed forms, test-run in place,
              then Save to publish.
            </p>
          </Section>

          <Section id="state" title="State tab">
            <p>
              Pin view functions (<Code>name</Code>, <Code>totalSupply</Code>,{" "}
              <Code>slot0</Code>, …) per contract into a live dashboard — one
              multicall fetches everything, refreshed on demand. Drag cards to
              rearrange, drag an edge to resize, drop in section titles.
            </p>
          </Section>

          <Section id="codegen" title="Codegen & AI import">
            <p>
              Every block deterministically generates its source — wagmi hooks,
              viem, Python (web3.py), Rust (alloy) or Solidity — with ABIs and
              addresses pulled from the address book. A notebook-level toggle
              shows the full runnable source, and the whole notebook exports as
              a JSON call manifest. The notebook is the integration spec you
              hand to the frontend, and it can&apos;t drift because you just
              ran it.
            </p>
            <p>
              <strong>AI import</strong> converts a Foundry <Code>.t.sol</Code>{" "}
              test into runnable blocks: <Code>vm.prank</Code> becomes a sender
              group, <Code>vm.deal</Code>/<Code>vm.warp</Code> become cheatcode
              cells, asserts become condition checks. Bring your own Google AI
              Studio key (free tier) — calls go straight from your browser to
              Google and never touch the Chainstitch server.
            </p>
          </Section>

          <Section id="anvil" title="Local chains & forks">
            <Pre>{"anvil                  # plain local chain\nanvil --fork-url $RPC  # fork mainnet/testnet state"}</Pre>
            <p>
              Point a project at <Code>http://127.0.0.1:8545</Code> (chain id
              31337). The custom RPC block drives cheatcodes —{" "}
              <Code>anvil_setBalance</Code>,{" "}
              <Code>anvil_impersonateAccount</Code>, <Code>evm_snapshot</Code>,{" "}
              <Code>evm_revert</Code> — and sender groups impersonate whales on
              forks without touching a private key. Write blocks sent by an
              impersonated sender need no wallet at all.
            </p>
          </Section>

          <Section id="team-mode" title="Team mode & self-hosting">
            <p>
              Same codebase, same database, one environment variable apart:
            </p>
            <DocsTable
              head={["", "local (default)", "team"]}
              rows={[
                ["Sign-in", "none", "Sign-In with Ethereum (SIWE)"],
                ["Who gets in", "whoever can reach the port", "invited wallets only"],
                ["Sharing", "—", "by wallet address, with roles"],
                ["Best for", "your laptop, trusted networks", "a team instance on a server"],
              ]}
            />
            <p>Team mode needs four variables (see <Code>.env.example</Code>):</p>
            <Pre>{"APP_MODE=team\nOWNER_WALLETS=0xYourAddress                    # comma-separated owners\nBETTER_AUTH_SECRET=$(openssl rand -base64 32)  # session signing key\nAPP_URL=https://notebook.example.com           # exact URL users visit"}</Pre>
            <p>
              Serve it over HTTPS behind any reverse proxy (sessions and SIWE
              messages are domain-bound to <Code>APP_URL</Code>), start with{" "}
              <Code>docker compose up -d --build</Code> or{" "}
              <Code>npm run build &amp;&amp; npm start</Code>, sign in with an
              owner wallet, and invite teammates from{" "}
              <strong>Settings</strong> (the gear button). Invites are just a
              wallet address and a role — no email server — claimed on that
              wallet&apos;s first sign-in.
            </p>
            <DocsTable
              head={["Role", "Can do"]}
              rows={[
                ["viewer", "read everything, run blocks with their own wallet"],
                ["editor", "+ edit contracts, notebooks, blocks, state views"],
                ["owner", "+ project settings & RPC URLs, members & invites, deletes"],
              ]}
            />
            <p>
              Share at whichever radius fits: the <strong>workspace</strong>{" "}
              (Settings → invite), a <strong>single project</strong> (its Share
              button — grantees see nothing else), or an{" "}
              <strong>anyone-with-the-link URL</strong> (viewer or editor, no
              account; resetting the link revokes every copy). Note that
              project access includes the project&apos;s RPC URL, since blocks
              execute in each member&apos;s browser — use rate-limited keys for
              shared projects.
            </p>
            <p>
              <strong>Never expose a local-mode instance to the internet</strong>{" "}
              — it has no auth by design. Private keys never touch the server
              in either mode: writes are signed in the browser, reads run
              client-side, and the server stores notebook definitions, never
              execution results.
            </p>
          </Section>

          <Section id="operations" title="Operations">
            <p>
              Everything lives in one SQLite file (<Code>data/chainstitch.db</Code>,
              override with <Code>CHAINSTITCH_DB_PATH</Code>). Back it up while
              running with{" "}
              <Code>sqlite3 data/chainstitch.db &quot;.backup backup.db&quot;</Code>.
              Upgrades are pull → build → restart; schema migrations apply
              automatically on boot. Switching an existing local instance to
              team mode keeps every project; switching back bypasses auth
              again, so only do that on a machine you trust end-to-end.
            </p>
            <p>
              Deployment guides (Docker, Node, Caddy, backups) live in the{" "}
              <a
                href={`${GITHUB_URL}#self-hosting`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                README&apos;s self-hosting section
              </a>
              .
            </p>
          </Section>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4 text-xs text-muted-foreground/60">
          <span>MIT licensed · issues and PRs welcome</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
          >
            GitHub
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}
