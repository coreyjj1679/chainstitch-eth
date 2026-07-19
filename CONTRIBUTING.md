# Contributing to Chainstitch

Thanks for helping! This guide gets you productive quickly and explains the
few rules that keep the project safe to change.

## Development setup

Requirements: Node 20+ (CI runs 22), npm. [Foundry](https://getfoundry.sh)
(`anvil`) only if you work on the execution engine.

```bash
npm install
npm run dev        # http://localhost:3000 — SQLite auto-creates in data/
```

That's the whole setup. There are no migrations to run; the schema
bootstraps and migrates itself on boot.

To develop against a live chain, run `anvil` and use the Anvil preset when
creating a project. To develop **team mode** (login, invites, roles):

```bash
APP_MODE=team \
OWNER_WALLETS=0xYourDevWalletAddress \
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
npm run dev
```

## Where things live

| Path | What it is |
| --- | --- |
| `src/lib/engine.ts` | Block execution (reads, simulate-then-write, RPC, impersonation) |
| `src/lib/codegen.ts` | wagmi/viem snippet generation |
| `src/lib/notebook-file.ts` | Portable notebook manifest (`chainstitch-notebook` v1): build, validate, format doc |
| `src/server/mcp.ts` | MCP server (`/api/mcp`) — agent tools as thin DAL wrappers |
| `src/server/dal/api-tokens.ts` | Personal API tokens for team-mode MCP (Bearer auth) |
| `src/lib/run-notebook.ts` | Shared Run-all / CLI notebook runner |
| `src/lib/expect.ts` | Expect-block evaluation (condition / event / revert) |
| `src/cli/main.ts` | `chainstitch run` headless CLI |
| `src/lib/variables.ts` | `{{variable}}` interpolation |
| `src/components/notebook/` | The notebook editor UI (blocks, results, code panels) |
| `src/stores/notebook-store.ts` | Editor state (Zustand), including read-only gating |
| `src/server/dal/` | **All database access** — workspace-scoped, role-checked |
| `src/server/auth*.ts` | Better Auth + SIWE setup, auth context resolution |
| `src/app/api/` | Route handlers — thin shells over the DAL |
| `src/db/` | Drizzle schema + boot-time bootstrap/migrations |
| `scripts/` | Smoke test, authorization suite, team-mode e2e |

## Invariants — please don't break these

1. **Zero-setup stays zero-setup.** `git clone && npm install && npm run
   dev` must always work with no env vars, no login, no migration step.
   Anything that adds friction to local mode needs a very good reason.
2. **Private keys never touch the server.** Writes are signed in the
   browser wallet. Chain execution is client-side — the server never makes
   chain calls or signs anything. Run outputs are stored only as opaque
   blobs the client hands over (notebook run-state, saved runs); don't add
   server-side signing or server-side execution.
3. **Authorization lives in the DAL.** Every function in `src/server/dal/`
   takes an auth context and scopes queries by workspace. New endpoints
   must go through the DAL — never query the database from a route
   handler — and new DAL functions need cases in `scripts/authz-test.ts`.
4. **RPC URLs are secrets.** They routinely embed API keys. Keep them out
   of logs and error messages.
5. **`APP_MODE` is server-side only.** Clients learn the mode from
   `/api/me`; don't introduce `NEXT_PUBLIC_` mode flags (one build must
   serve any mode).

## Checks to run before a PR

```bash
npm run lint              # eslint
npx tsc --noEmit          # typecheck
npm run test:expect       # expect-block unit tests (no chain)
npm run test:authz        # role & workspace isolation rules (temp DB, fast)
npm run test:team         # end-to-end SIWE login/invite/role flow (~20s)
npm run smoke             # engine vs anvil — needs anvil running
npm run test:run-notebook # runNotebook + expects vs anvil
npm run test:cli-runner   # chainstitch run exit codes vs anvil
```

CI runs all of these (plus a production build) on every PR. Auth suites
create their own throwaway databases and never touch `data/`. Headless
execution lives in the **CLI** (`npx chainstitch run`) — never add
server-side signing or chain calls (invariant #2).

## Pull requests

- Keep PRs small and focused; separate refactors from behavior changes.
- New API routes or DAL functions ship with authorization test cases.
- User-facing changes update the relevant `README.md` section (features,
  self-hosting, operations).
- Follow the existing code style; comments explain *why*, not *what*.
- A note for AI-assisted contributions: `AGENTS.md` files in this repo
  carry instructions for coding agents — they apply to your tools too.

## Licensing of contributions

Chainstitch is [MIT-licensed](LICENSE). By submitting a pull request,
you agree that your contribution is licensed under the MIT license
(inbound = outbound) and that you have the right to submit it.

## Security issues

Never report vulnerabilities in public issues or PRs — see
[SECURITY.md](SECURITY.md) for the private reporting process.
