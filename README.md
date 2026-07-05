<div align="center">
  <h1>Chainstitch</h1>
  <p><em>Collaborative notebooks for smart contracts — compose, run, and share on-chain calls like Jupyter cells.</em></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
    <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js 16">
    <img src="https://img.shields.io/badge/viem_+_wagmi-v2-blue.svg" alt="viem + wagmi v2">
    <img src="https://img.shields.io/badge/SQLite-zero--config-07405e.svg" alt="SQLite, zero-config">
    <img src="https://img.shields.io/badge/self--hosted-✪-2ea44f.svg" alt="self-hosted">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome">
  </p>
  <p>
    <a href="#features">Features</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="#self-hosting">Self-hosting</a> &nbsp;·&nbsp;
    <a href="#tech-stack">Tech stack</a> &nbsp;·&nbsp;
    <a href="#contributing">Contributing</a>
  </p>
  <br>
  <img src="screenshots/demo.gif" alt="Chainstitch — running a notebook of Uniswap V3 + Chainlink reads against Ethereum mainnet" width="860">
</div>

Chainstitch is an open-source, local-first collaboration tool for working
with deployed smart contracts. Compose reads, writes, and raw RPC calls into a
notebook, chain them together with `{{variables}}`, and run them cell by cell —
then share the notebook with your team as a single source of truth. Every block
also generates its wagmi/viem source, so a notebook doubles as living, runnable
integration docs.

- **Own everything.** One SQLite file on your machine. No accounts, no
  telemetry, no license server, nothing phones home.
- **Zero setup.** `npm install && npm run dev` — the database creates and
  migrates itself.
- **Share when ready.** Flip on team mode and invite teammates by wallet
  address — sign-in is an Ethereum signature (SIWE), so there's no email server
  to configure and no passwords to manage.

The GIF above is a real recording (no wallet, no writes): it derives the
Uniswap V3 USDC/WETH 0.05% pool from the factory, reads its state, pulls the
Chainlink ETH/USD price, and fires two raw RPC calls — all against Ethereum
mainnet, chained with `{{usdc}}` / `{{weth}}` / `{{pool}}`.

## Features

### Notebooks that chain like Jupyter cells

Ordered blocks, drag to reorder, autosaved, run per-block or top-to-bottom.
Name a block's output and reference it downstream — `{{pool}}`,
`{{receipt.blockNumber}}`, `{{round.answer}}` — with dot/bracket paths into
prior results. Read blocks call view/pure functions; Events blocks query a
contract event over a block range and decode every match; RPC blocks cover
`getBlock`, `getBalance`, `getLogs`, … plus a raw custom-method escape hatch
for anvil cheatcodes.

<p align="center">
  <img src="screenshots/hero-notebook.png" alt="A notebook deriving the Uniswap V3 pool from the factory and reading its slot0 state, with decoded outputs">
  <br><sub>Block 1 derives the pool address from <code>UniswapV3Factory.getPool</code>; block 2 reads <code>slot0</code> on that pool — outputs decode and chain forward.</sub>
</p>

### Edit blocks, pipe outputs with `{{variables}}`

Each cell opens to a typed form generated from the ABI. Constants and upstream
outputs surface as one-click `{{chips}}` you can paste into any field, so
multi-step flows (approve → deposit → check balance) stay readable.

<p align="center">
  <img src="screenshots/editor-blocks.png" alt="An expanded read block showing contract and function selectors, a {{usdc}} argument, and the variable chip picker">
  <br><sub>Contract &amp; function selectors from the address book, a <code>{{usdc}}</code> argument, and the output saved as <code>pool</code>.</sub>
</p>

### Readable code, by the block or the whole notebook

Every block deterministically generates a wagmi-hooks or viem snippet; a
notebook-level toggle shows the full runnable source, and the whole notebook
exports as a JSON call manifest. The notebook becomes the integration spec you
hand to the frontend — and it stops drifting because it's the same artifact you
just ran.

<p align="center">
  <img src="screenshots/codegen-source.png" alt="A read block with its source toggle open, showing the generated wagmi useReadContract hook in five flavor tabs">
  <br><sub>Every block carries its own source toggle — copy-pasteable wagmi, viem, Python, Rust or Solidity, with ABIs from your address book.</sub>
</p>

### Address book

Fetch a verified ABI by pasting an address — Sourcify and Blockscout out of
the box, Etherscan too with a free `ETHERSCAN_API_KEY` — or drag &amp; drop
ABI JSON (raw arrays or Foundry/Hardhat artifacts) and fill in deployed
addresses. Proxies resolve automatically: explorer proxy hints plus an
EIP-1967 slot read pair the proxy address with the implementation ABI (works
on anvil forks — pick the fork's source chain in the lookup). The same
address book feeds every notebook, the codegen, and the State tab — one
source of truth per project.

<p align="center">
  <img src="screenshots/address-book.png" alt="The address book: the fetch-by-address lookup resolving USDC to its implementation ABI, above Uniswap V3 and Chainlink entries">
  <br><sub>Looking up USDC resolves the proxy to its <code>FiatTokenV2_2</code> implementation ABI — one click adds it beside the Uniswap V3 and Chainlink entries, all real mainnet addresses.</sub>
</p>

### State tab

Pin view functions (`name`, `symbol`, `totalSupply`, `slot0`, `latestAnswer`,
…) per contract; they're fetched in one multicall and refreshed on demand.
Drag cards to rearrange, drag an edge to resize, drop in section titles.

<p align="center">
  <img src="screenshots/state-tab.png" alt="The State dashboard with live Uniswap pool and Chainlink ETH/USD cards">
  <br><sub>Live mainnet state — pool liquidity/fee/tokens and the Chainlink ETH/USD price, refreshed with one click.</sub>
</p>

### Recipes — save a flow once, rerun it as one cell

Select blocks in any notebook and save them as a named **recipe** — the
classic one is *check the allowance, approve only if it's too low*. Recipes
drop into any notebook from the add-block menu, either as a linked **Recipe
cell** that reruns every step in one click, or pasted as editable blocks
(a linked cell can be “detached” into blocks later). Steps keep full notebook
semantics: they read and write `{{variables}}`, `if` groups and “run when”
guards skip what shouldn't run, and sender groups pick the caller. Recipes
live in the sidebar right below your notebooks and **open in the same
editor**: tweak steps with the full typed forms, test-run them in place, then
hit Save — edits publish explicitly, and every linked cell follows. You can
also start a recipe from scratch there, or overwrite one with a fresh
selection via the bookmark dialog's “Save to” picker.

<p align="center">
  <img src="screenshots/recipe-cell.png" alt="A linked recipe cell after a run — the recipe name, its three steps, and the 3-steps-ran output">
  <br><sub>A linked “Chain health check” cell: one click reran all three steps — expand <code>details</code> for each step's output, or detach it back into editable blocks.</sub>
</p>

<p align="center">
  <img src="screenshots/recipes-editor.png" alt="A recipe open in the notebook editor, with its steps, output variables, and the Save button">
  <br><sub>Recipes open from the sidebar into the same editor as notebooks — tweak steps with the typed forms, test-run in place, then <b>Save</b> to publish to every linked cell.</sub>
</p>

### AI import — Foundry tests become notebooks

Paste a `.t.sol` test file *(bring your own free Gemini key)* and it converts
into runnable blocks: `vm.prank` becomes a sender group, `vm.deal`/`vm.warp`
become anvil cheatcode cells, asserts become condition checks — preview,
insert, edit. Feed it context for real-world suites: drop the imported
`.sol` files (base tests, interfaces) and Foundry artifacts
(`out/**/*.json` — missing contracts are added to the address book on
insert), pick which test functions to convert, and run the one-request
pre-flight check to see what's missing before converting. Uses Google AI
Studio's free tier (~1,500 requests/day, no card); calls go straight from
your browser to Google, and the key never touches the Chainstitch server.

<p align="center">
  <img src="screenshots/ai-import-input.png" alt="The AI import dialog with a pasted Foundry fork test, a dropped Vault artifact, the test-function picker and the pre-flight report">
  <br><sub>A pasted fork test plus a dropped <code>Vault.json</code> artifact; the pre-flight check reports what's covered — two contracts from the address book, one from the artifact — before a conversion is spent.</sub>
</p>

<p align="center">
  <img src="screenshots/ai-import-preview.png" alt="The conversion preview: 16 blocks with sender groups and condition checks, warnings, and the importable Vault contract">
  <br><sub>The preview before inserting: <code>vm.startPrank</code> became a sender group, asserts became <code>if</code> blocks, un-convertible setup surfaced as warnings — and the Vault ABI is added to the address book on insert.</sub>
</p>

### Version history & saved runs

Notebooks keep a Google-Docs-style edit history: every save is recorded
automatically (consecutive edits by the same editor group into one version),
with editor names, a block-level diff against the previous version, and
one-click restore — restoring appends a new version, so nothing is ever
lost. And every **Run all** / **Simulate all** pass stores its full output
as an immutable record in the sidebar's **Saved runs** group; each opens in
its own tab showing exactly what every block returned at the time, even
after the notebook changes.

<p align="center">
  <img src="screenshots/version-history.png" alt="The version history dialog: versions with editors on the left, a block-level diff (added, removed and changed blocks) on the right, and a Restore button">
  <br><sub>Version history: editing sessions on the left; the selected version's diff — added, removed and changed blocks with old → new values — plus one-click <b>Restore</b>.</sub>
</p>

<p align="center">
  <img src="screenshots/run-tab.png" alt="A saved run opened in its own tab: the frozen output of every block from a Run-all pass, with the Saved runs sidebar group at the bottom left">
  <br><sub>A saved run in its own tab — the frozen <code>Out [n]</code> of every block from that pass. The <b>Saved runs</b> group sits at the bottom of the sidebar.</sub>
</p>

### And more

- **Document tabs & project overview** — notebooks, recipes and saved runs
  open in browser-style tabs above the editor: switch with a click, close
  with the ✕ or a middle-click, drag to reorder, and the open set persists
  per project in your browser. Each project's **Overview** page is the
  explorer for its notebooks, recipes, contracts and state dashboard.
- **In-app docs** — `/docs` walks through usage, anvil workflows and
  self-hosting, right inside the app (public on team-mode instances).
- **Write blocks simulate first** — revert reasons surface *before* the wallet
  prompt — then send and await the receipt.
- **Decoded events & receipts** — every write receipt auto-decodes its logs
  against the address book into an **Events** tab, so "did the right event
  fire?" is answered at a glance. The **Events block** does the reverse
  lookup: query a contract event over a block range (with indexed-topic
  filters and `{{variable}}` support) and use the decoded matches downstream,
  e.g. `{{logs[0].args.to}}`.
- **Simulate as anyone** — dry-run entire notebooks as any address via
  `eth_call`; on anvil forks, impersonated writes need no keys at all.
- **Text** blocks (markdown), **variable** blocks (named constants), and
  **sender groups** (run child blocks as a chosen caller).
- **Condition blocks** — an `if` group runs its blocks only when a condition
  on prior outputs holds (`{{allowance}} < {{amount}}` → approve only when
  needed); a per-block "run when" guard does the same for single cells.
- **Team workspaces** *(optional)* — Sign-In with Ethereum, invite-only access
  by wallet address, viewer / editor / owner roles. Share the whole workspace
  from Settings, or a single project from its Google-Docs-style **Share**
  button.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create a project (there's an Anvil preset).
Every new project starts with a **Welcome notebook** — a runnable tour of
blocks, variables, conditions and recipes that works against any RPC, no
contracts or wallet needed. When you're done with it, drop your ABIs in the
Contracts tab, start your own notebook, and delete the tour.

Wallet connect uses injected wallets (MetaMask, Rabby, …) out of the box. For
WalletConnect (QR / mobile), set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in
`.env.local` (see `.env.example`). Reads work with no wallet connected — point
a project at any Ethereum RPC and start with `eth_call`.

### Local chain workflow

```bash
anvil                  # plain local chain
anvil --fork-url $RPC  # fork mainnet/testnet state
```

Point your project at `http://127.0.0.1:8545` (chain id 31337). The custom RPC
block drives anvil cheatcodes (`anvil_setBalance`,
`anvil_impersonateAccount`, `evm_snapshot`, `evm_revert`), and sender groups
can impersonate whales on forks without touching a private key.

## Self-hosting

Chainstitch runs in one of two modes — same codebase, same database, one
environment variable apart:

| | `local` (default) | `team` |
| --- | --- | --- |
| Sign-in | none | Sign-In with Ethereum (SIWE) |
| Who gets in | whoever can reach the port | invited wallets only |
| Sharing | — | invite by wallet address, with roles |
| Best for | your laptop, trusted networks | a team instance on a server |

### From clone to team, start to finish

1. **Get a box and a name.** Any small VPS works. Point a DNS record (say
   `notebook.example.com`) at it and clone the repo there.
2. **Configure team mode.** `cp .env.example .env` and set the four
   variables below, plus `APP_DOMAIN=notebook.example.com` for TLS.
   `APP_URL` must be the *exact* URL the team will type
   (`https://notebook.example.com`).
3. **Start it with HTTPS.** Sessions and wallet sign-in are domain-bound, so
   serve TLS. The bundled Caddy overlay does it in one command, certificate
   included:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

   (Already have nginx/Traefik/Caddy on the box? Skip the overlay, run
   `docker compose up -d --build`, and reverse-proxy `localhost:3000`
   yourself — or see [Deploy with Node](#deploy-with-node).)
4. **Sign in and share.** Open the domain, sign in with an `OWNER_WALLETS`
   wallet, and hand out access at whichever radius fits: the whole workspace
   (**Settings** → invite by wallet + role), a single project (its **Share**
   button), or an **anyone-with-the-link** URL for view/edit access with no
   account at all. Teammates just open the site and sign with their wallet —
   invites are claimed on first sign-in, no email involved.

### No domain yet?

Three ways to run a team instance without buying one:

- **sslip.io (recommended — stable URL, no signup).** Hostnames like
  `notebook.203-0-113-7.sslip.io` resolve to `203.0.113.7` automatically —
  put your VPS IP (dashes for dots) in the name and use the Caddy overlay
  exactly as above, with `APP_DOMAIN=notebook.<your-ip>.sslip.io`. The URL
  is stable as long as the VPS IP is. One caveat: Let's Encrypt rate
  limits are shared by all sslip.io users, so certificate issuance can
  occasionally need a retry.
- **Cloudflare quick tunnel (trials only).**
  `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d`
  gives you an `https://….trycloudflare.com` URL with no account, no domain
  and no open ports — but the URL is random and **rotates on every tunnel
  restart**, and sign-in sessions and share links are bound to it, so each
  rotation logs everyone out until you update `APP_URL`. Fine for showing
  the team; wrong for the instance they bookmark. (A permanent *named*
  tunnel is great — but requires a domain on Cloudflare anyway.)
- **Tailscale (private team, nothing public).** If everyone installs
  Tailscale, `tailscale serve --bg 3000` on the VPS gives a stable
  `https://<host>.<tailnet>.ts.net` URL with a real certificate, reachable
  only inside your tailnet. Set that as `APP_URL` and skip both overlays.

### Team mode in four variables

```bash
APP_MODE=team
OWNER_WALLETS=0xYourAddress                    # comma-separated owners
BETTER_AUTH_SECRET=$(openssl rand -base64 32)  # session signing key
APP_URL=https://notebook.example.com           # exact URL users visit
```

Start the app, sign in with an owner wallet, then invite teammates from
**Settings** (the gear button in the header) — an invite is just a wallet
address and a role, claimed automatically the first time that wallet signs
in. The sign-in signature is domain-bound to `APP_URL`, costs nothing, and
never touches a chain — it's identity only. Roles:

| Role | Can do |
| --- | --- |
| viewer | read everything, run blocks with their own wallet |
| editor | + edit contracts, notebooks, blocks, state views |
| owner | + project settings & RPC URLs, members & invites, deletes |

An invite grants the whole workspace by default, but can be scoped to a
**single project** instead — pick a scope in Settings, or use the **Share**
button in any project's header (Google-Docs style: wallet + role, see who has
access, revoke). A project-scoped wallet gets that role on that project only
and sees nothing else — handy for auditors or outside collaborators — and
project owners can share their own project onward without any workspace-wide
rights. For existing members a project grant can raise (never lower) their
role on that one project. Note that project access includes the project's RPC
URL, since blocks execute in the member's browser.

The Share dialog can also turn on **“anyone with the link”**: a secret URL
that opens that one project without any sign-in, as viewer (view & run) or
editor — wallets never see it, reads still run from the visitor's browser.
Resetting the link invalidates every copy that was handed out; turning it off
does so instantly. Owner rights are never grantable by link.

<p align="center">
  <img src="screenshots/share-dialog.png" alt="The project Share dialog: invite a wallet with a role, see who has access and via what, revoke grants and pending invites">
  <br><sub>Every project has a Share dialog: invite by wallet, choose a role, see who has access (and why), revoke in one click.</sub>
</p>

<p align="center">
  <img src="screenshots/settings.png" alt="The Settings page: invite form with workspace/project scope, member list with roles and project grants, pending invites">
  <br><sub>Workspace-wide access lives in <b>Settings</b> — members, roles, per-project grants and pending invites in one place.</sub>
</p>

Switching an existing local instance to team mode keeps all your projects; they
become the shared workspace, owned by `OWNER_WALLETS` after first sign-in.
Switching back (`APP_MODE=local`) bypasses auth again — only do that on a
machine you trust end-to-end.

### Deploy with Node

```bash
npm ci && npm run build
APP_MODE=team OWNER_WALLETS=0x… BETTER_AUTH_SECRET=… APP_URL=https://… \
  npm start          # serves on :3000
```

### Deploy with Docker

```bash
docker build -t chainstitch .
docker run -d --name chainstitch -p 3000:3000 \
  -v ./data:/app/data \
  -e APP_MODE=team \
  -e OWNER_WALLETS=0xYourAddress \
  -e BETTER_AUTH_SECRET=change-me \
  -e APP_URL=https://notebook.example.com \
  chainstitch
```

If you keep the variables in a `.env` file (copy `.env.example`), replace the
`-e` flags with `--env-file .env` — plain `docker run` does **not** read
`.env` by itself. To apply a rebuild or config change, remove the old
container first, then run again: `docker rm -f chainstitch` (your data
survives — it lives in the mounted `data/` directory).

Or use the included `docker-compose.yml`, which reads the same variables from
a `.env` file automatically: `docker compose up -d --build`. All state lives
in the mounted `data/` directory. One caveat: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is
inlined at **build** time (Next.js public-env semantics), so it must be set
when the image is built — passing it at `docker run` has no effect. Injected
browser wallets work without it.

### Production notes

- Put a reverse proxy (Caddy, nginx, Traefik) in front for TLS — sessions are
  httpOnly cookies (marked `Secure` over HTTPS) and SIWE messages are
  domain-bound to `APP_URL`, which must be the exact URL users visit.
- Signed-out visitors on a team-mode instance see a landing page at `/`,
  and `/docs` is public too (all other app routes stay login-gated).
  Optional env vars wire the landing buttons: `DEMO_SHARE_URL` (a project's
  "anyone with the link" URL for the Try-the-demo button) and `GITHUB_URL`
  (defaults to the Chainstitch repo) — both read at request time, no
  rebuild needed.
- **Serverless hosts (Vercel & friends) can serve the marketing site only.**
  The backend is a SQLite file, which needs a persistent disk — a team
  instance won't survive on serverless. Deploy there with `APP_MODE=team`
  plus `APP_INSTANCE_URL=https://your-instance.example.com`: that build
  serves `/` and `/docs` and redirects everything else (login, share
  links, API) to the real instance, so the database never loads.
- Building the image **on a small VPS (≤ 1 GB RAM)** needs a swapfile —
  `npm ci` and `next build` are the hungry steps (the Dockerfile already
  raises Node's heap cap for them):

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

  Runtime is modest — a 1 GB box runs Chainstitch fine once built. On
  anything smaller (512 MB), skip on-box builds entirely: CI publishes the
  image to GHCR on every push to `main`, and the
  `docker-compose.image.yml` override runs it directly:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml \
  -f docker-compose.image.yml pull chainstitch
docker compose -f docker-compose.yml -f docker-compose.tls.yml \
  -f docker-compose.image.yml up -d --no-build
```

  (Building your own instead? `docker buildx build --platform linux/amd64
  -t chainstitch:latest --load .`, ship it with `docker save … | ssh … 
  'docker load'`, and set `CHAINSTITCH_IMAGE=chainstitch:latest` in `.env`.)
- Never expose a `local`-mode instance to the internet; it has no auth by
  design. Use `team` mode for anything reachable by others.
- Removing a member locks them out immediately; they can't sign back in unless
  re-invited or listed in `OWNER_WALLETS`.

### Operations

- **Backups** — everything is one SQLite file. Safe while running:
  `sqlite3 data/chainstitch.db ".backup data/backup-$(date +%F).db"`. If you copy
  the raw file instead, stop the app first or include the `-wal`/`-shm` files
  (WAL mode is on).
- **Upgrades** — pull, build, restart (or pull the new image). Schema
  migrations apply automatically on boot; there is never a manual migration
  step.
- **Database location** — override with `CHAINSTITCH_DB_PATH=/path/to/file.db`
  (default: `data/chainstitch.db`).

## Privacy by construction

Private keys never touch the server: writes are signed in the browser wallet,
and reads/RPC calls execute client-side against your project's RPC. The server
stores notebook *definitions* (including their edit history) and the run
outputs your workspace keeps — the notebook's live run-state and saved
Run-all records; execution itself happens entirely in the browser. RPC URLs
are visible to workspace members whose browsers execute against them, so use
rate-limited or public keys for shared projects.

## Tech stack

| Layer | Tech |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) (App Router, TypeScript) — API routes are the whole backend |
| Ethereum | [viem](https://viem.sh) + [wagmi](https://wagmi.sh) v2 · [RainbowKit](https://rainbowkit.com) for wallet connect |
| Auth (team mode) | [Better Auth](https://better-auth.com) with its SIWE plugin (ERC-4361), verified via viem |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team) + better-sqlite3 — zero-config, auto-migrating |
| UI | Tailwind CSS v4 · shadcn/ui · dnd-kit (reordering) · shiki (code highlighting) |
| State / data | Zustand (notebook editor) · TanStack Query (server state) |

## Tests

```bash
npm run smoke        # execution engine against a running anvil node
npm run test:authz   # role & workspace isolation rules (temp database)
npm run test:team    # end-to-end SIWE login/invite/role flow (own server)
```

`smoke` deploys a Counter contract and exercises the engine, variable
interpolation, RPC blocks, and codegen. The other two spin up their own
throwaway databases and never touch your data.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
the code map, and the project invariants. Before opening a PR, make sure
`npm run lint`, `npm run test:authz`, and `npm run test:team` pass
(`npm run smoke` too if you touched the execution engine — it needs a local
anvil). Security reports go through [SECURITY.md](SECURITY.md), never public
issues.

## License

[MIT](LICENSE)
