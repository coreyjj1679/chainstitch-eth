import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { GITHUB_URL } from "@/lib/site";
import { GithubLink } from "@/components/github-link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DocsToc } from "./toc";

export const metadata: Metadata = {
  title: "Docs — Chainstitch",
  description:
    "How to use and self-host Chainstitch: notebooks, blocks, variables, recipes, the address book, the MCP server for coding agents, anvil workflows, security, and team mode.",
};

const TOC = [
  ["quick-start", "Quick start"],
  ["projects", "Projects & contracts"],
  ["notebooks", "Notebooks & blocks"],
  ["recipes", "Recipes"],
  ["state", "State tab"],
  ["codegen", "Codegen & AI import"],
  ["agents", "AI agents & MCP"],
  ["ci", "Expect blocks & CI"],
  ["anvil", "Local chains & forks"],
  ["team-mode", "Team mode & self-hosting"],
  ["security", "Security & your data"],
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
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

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-10 px-6 py-10">
        {/* Left rail: sticky section nav (scroll-spy) */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-20">
            <p className="mb-2 px-3 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
              On this page
            </p>
            <DocsToc items={TOC} />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center gap-1 px-3 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              Full README on GitHub
              <ArrowUpRight className="size-3" />
            </a>
          </div>
        </aside>

        <main className="min-w-0 max-w-3xl flex-1">
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

        {/* Compact TOC for viewports without the left rail */}
        <nav className="mb-10 flex flex-wrap gap-1.5 lg:hidden">
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
              Open <Code>http://localhost:3000</Code> — a fresh instance boots
              with an <strong>Example project</strong> (Ethereum mainnet via a
              public RPC) whose <strong>Welcome notebook</strong> is a runnable
              tour of blocks, variables, conditions and recipes: open it and
              hit <em>Run all</em>, no contracts and no wallet needed. The
              SQLite database creates and migrates itself; there is no other
              setup. Every project you create seeds the same tour against its
              own RPC — there&apos;s an Anvil preset for local chains, or point
              it at any endpoint. Delete the example when you&apos;re done.
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
              hand to your app team, and it can&apos;t drift because you just
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

          <Section id="agents" title="AI agents & MCP">
            <p>
              Every instance is an{" "}
              <strong>MCP server (Model Context Protocol)</strong> at{" "}
              <Code>/api/mcp</Code>: connect Cursor, Claude Code or any
              MCP-capable coding agent and it can read your address book,
              author notebooks, and pull any notebook back as generated
              source. No extra process — it&apos;s the app you already have
              running.
            </p>
            <p>
              <strong>Local mode</strong> needs no credentials (the instance
              is already yours). Point the agent at localhost:
            </p>
            <Pre>{`// .cursor/mcp.json — local mode
{
  "mcpServers": {
    "chainstitch": { "url": "http://localhost:3000/api/mcp" }
  }
}`}</Pre>
            <p>
              <strong>Team mode</strong> uses a personal{" "}
              <strong>API token</strong> (SIWE can&apos;t be done headlessly).
              Create one under <em>Settings → Agent tokens</em>, then pass it
              as a Bearer header. The token inherits{" "}
              <em>your</em> workspace and project roles — revoke it anytime.
            </p>
            <Pre>{`// .cursor/mcp.json — team mode
{
  "mcpServers": {
    "chainstitch": {
      "url": "https://your-instance.example/api/mcp",
      "headers": {
        "Authorization": "Bearer cst_…"
      }
    }
  }
}`}</Pre>
            <DocsTable
              head={["Tool", "What it does"]}
              rows={[
                ["list_projects", "Projects with chain id and your role"],
                ["list_contracts", "The address book, as function/event signatures"],
                ["add_contract", "Add an ABI — pass one, or auto-fetch verified source by address"],
                ["list_notebooks / get_notebook", "Browse; read a notebook as a portable manifest"],
                ["create_notebook", "Author a notebook from a manifest (missing ABIs created on the fly)"],
                ["update_notebook_blocks", "Replace a notebook's content in place — the old version stays restorable in edit history"],
                ["get_notebook_code", "Whole notebook as wagmi / viem / Python / Rust / Solidity source"],
                ["get_notebook_format", "The manifest format spec, for the agent to read first"],
              ]}
            />
            <p>
              The handoff becomes a prompt, in both directions: an agent
              turns &quot;set up the deposit flow&quot; into{" "}
              <strong>a runnable notebook</strong> (it hands back the URL —
              you hit <em>Run all</em>), and pulls any tested notebook back
              out <strong>as wagmi hooks</strong> instead of re-deriving
              calls from an ABI.
            </p>
            <p>
              The same manifest travels without an agent too:{" "}
              <Code>GET /api/notebooks/:id/file</Code> exports it (as does
              the editor&apos;s download button),{" "}
              <Code>POST /api/projects/:id/notebooks/import</Code> imports
              it — so notebooks can live in the contracts repo and go through
              PR review. Manifests carry blocks plus the ABIs they reference,
              never RPC URLs.
            </p>
            <p>
              Agents create and read <em>definitions</em>; execution stays in
              your browser (or the CLI below). Writes stay signed by your
              wallet — the server never holds keys.
            </p>
          </Section>

          <Section id="ci" title="Expect blocks & CI">
            <p>
              An <strong>Expect</strong> cell fails the run when unmet (unlike
              a soft Condition group that only skips children):
            </p>
            <DocsTable
              head={["Kind", "Checks"]}
              rows={[
                ["condition", "{{balance}} > 0 — same grammar as if / run-when"],
                ["event", "Decoded event on the last write (or from a variable)"],
                ["revert", "Simulates a call and requires it to revert (optional reason)"],
              ]}
            />
            <p>
              Export the notebook as a <Code>chainstitch-notebook</Code> file
              and run it headlessly — exit code non-zero when any expect fails:
            </p>
            <Pre>{`# local anvil
npx chainstitch run ./flow.notebook.json --rpc-url http://127.0.0.1:8545

# fresh fork
npx chainstitch run ./flow.notebook.json --fork-url $ETH_RPC_URL`}</Pre>
            <p>
              Writes use sender-group impersonation on anvil, or pass{" "}
              <Code>--private-key</Code> for a burner. The CLI does not talk
              to the Chainstitch server.
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

          <Section id="security" title="Security & your data">
            <p>
              Chainstitch is built so the scary things can&apos;t happen{" "}
              <strong>by construction</strong>, not by policy:
            </p>
            <DocsTable
              head={["Invariant", "What it means"]}
              rows={[
                [
                  "Keys never touch the server",
                  "Writes are signed in your own browser wallet. There is no server-side signing capability at all, in any mode.",
                ],
                [
                  "Execution is client-side",
                  "Reads, writes and RPC calls go straight from your browser to your RPC endpoint. The server never proxies chain traffic.",
                ],
                [
                  "Results are never stored server-side",
                  "The database holds notebook definitions (projects, ABIs, blocks) — not what they returned when you ran them.",
                ],
                [
                  "Your data is one file you own",
                  "Everything lives in a single SQLite file on your machine or server. No telemetry, no license server, nothing phones home.",
                ],
              ]}
            />
            <p>
              <strong>Team-mode authentication</strong> is Sign-In with
              Ethereum done carefully: single-use nonces, signatures
              domain-bound to your <Code>APP_URL</Code> (a message signed for
              another site can&apos;t be replayed against yours), httpOnly{" "}
              <Code>Secure</Code> session cookies, and an invite-only sign-in
              policy — an uninvited wallet cannot even create an account.
              Signing in costs nothing and touches no chain; it proves wallet
              ownership, nothing more. Removing a member locks them out
              immediately.
            </p>
            <p>
              <strong>Authorization is enforced server-side</strong>, in one
              data-access layer that scopes every query by workspace and
              project role — never just hidden in the UI. Cross-tenant
              isolation and the role matrix are pinned by regression suites
              (130+ assertions) that run in CI on every change.
            </p>
            <p>
              <strong>The one trade-off to know about:</strong> anyone who can
              open a project can see its RPC URL, because their browser
              executes calls against it. Use rate-limited or public RPC keys
              for shared projects. Share links carry viewer or editor rights
              only (never owner), are re-validated on every request, and
              resetting one instantly invalidates every copy.
            </p>
            <p>
              The server makes exactly one kind of outbound request — the
              ABI lookup — and it is restricted to a fixed allowlist of
              explorer hosts, with redirects refused and responses
              size-capped. Found a hole anyway? Report it privately via
              GitHub&apos;s{" "}
              <a
                href={`${GITHUB_URL}/security`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Security tab
              </a>{" "}
              — acknowledgement within 72 hours, assessment within 7 days,
              credit when the fix ships.
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
      </div>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 text-xs text-muted-foreground/60">
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
