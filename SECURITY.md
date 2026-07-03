# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue.

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on this repository. Include reproduction steps, the impact
you see, and the version/commit you tested.

What to expect:

- Acknowledgement within **72 hours**.
- An assessment and fix plan within **7 days** for confirmed issues.
- Credit in the release notes when the fix ships (unless you prefer not).

There is currently no bug bounty program.

## Supported versions

Security fixes land on `main` and in the latest release. Older releases are
not patched — self-hosters should track releases and upgrade (schema
migrations apply automatically on boot).

## Scope: what matters most here

Reports in these areas are especially valuable:

- **Workspace isolation** — any way for a signed-in user to read or write
  another workspace's projects, contracts, notebooks, blocks, or state
  views. Every data-access function is workspace-scoped by design
  (`src/server/dal/`); `npm run test:authz` encodes the expected rules.
- **Authentication (team mode)** — SIWE verification (nonce reuse, domain
  binding, signature checks), session handling, the invite-only sign-in
  policy, and role enforcement (viewer / editor / owner).
- **Secret exposure** — RPC URLs frequently embed third-party API keys.
  Any way to read a project's RPC URL without workspace membership, or to
  leak it into logs or error messages, is a vulnerability.
- **Server-side request forgery / injection** in API routes.

## Explicitly out of scope (by design)

- **`local` mode has no authentication.** It is intended for `localhost`
  or trusted private networks only, and the documentation says so. "I can
  access an internet-exposed local-mode instance" is a deployment mistake,
  not a vulnerability.
- **Workspace members can see project RPC URLs.** Execution is client-side;
  members' browsers must talk to the RPC endpoint directly. Documented in
  the README, with the recommendation to use rate-limited or public keys
  for shared projects.
- **On-chain outcomes of user-composed transactions.** The app never holds
  private keys — writes are signed by the user's own browser wallet — and
  what a user chooses to sign is their responsibility.
- Vulnerabilities in third-party RPC providers or wallets.

## Security model in one paragraph

Private keys never touch the server. Contract reads, writes, and RPC calls
execute in the browser against the project's configured RPC endpoint; the
server stores notebook *definitions* (projects, ABIs, blocks) and, in team
mode, auth tables — never execution results. Sessions are httpOnly
cookies; SIWE messages are single-use-nonce and domain-bound. All
authorization is enforced server-side in the data access layer, not in the
UI.
