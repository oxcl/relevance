# Relevance

Modify Android apps, build them in **your own GitHub Actions**, and publish them to your own
**F-Droid repository** and **app store website** on GitHub Pages — kept up to date automatically.

Live: https://relevance.cocoparrot-backend.workers.dev

## How it fits together

```
 Browser (static Svelte app)  ──GitHub API──▶  your repository
        │                                      ├─ relevance.json          apps, patches, settings
        │                                      ├─ .relevance/engine.mjs   build engine (auto-updated)
        │                                      ├─ .relevance/state/*.json build state & history
        │                                      ├─ .github/workflows/      build · publish · daily updates
        │                                      └─ Releases (APKs) + Pages (F-Droid repo & store)
        │
        └──▶ Cloudflare Worker (thin glue, no database)
              OAuth · CORS-free source previews · log relay (Durable Object) · uploads · email
```

- **app/** — the web app (Svelte 5 + Vite). All data lives in the user's repository.
- **engine/** — the build engine, bundled to one file and committed into each user's repository.
  APKPure apps are listed and downloaded with EFF's [apkeep](https://github.com/EFForg/apkeep)
  (pinned by SHA-256), because APKPure's website challenges CI runners.
  Steps: plan → fetch (merges XAPK/APKS with APKEditor) → patch (ReVanced CLI, Morphe CLI, LSPatch)
  → customize (apktool: name, package, icon) → sign (apksigner) → publish (GitHub release)
  → site (fdroidserver index + static store site).
- **worker/** — Cloudflare Worker. Live build logs are pushed by the engine with a GitHub Actions
  OIDC token and relayed to the browser over WebSocket.
- **shared/** — data model, version selection, source adapters (APKPure, F-Droid, GitHub
  Releases, direct URL, upload) and workflow templates.
- **.github/workflows/index.yml** — indexes ReVanced, Morphe and LSPosed patch lists every 6 hours
  into the `index` branch (used for patch selection and version picking).

## Develop

```sh
nix develop            # bun, node, wrangler, java, apktool, apksigner
bun install
bun test tests/        # engine unit tests
bun run dev            # vite dev server (proxy /api to `wrangler dev` on :8787)
bun run deploy         # build + wrangler deploy
```

### Worker secrets

| Secret | Purpose |
| --- | --- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth App (callback `/api/auth/callback`) |
| `SESSION_SECRET` | signs email tokens |

Email notifications need a Cloudflare `send_email` binding named `EMAIL` (requires a domain with
Cloudflare Email Routing/Sending) and an `EMAIL_FROM` variable. Without it, the other three
channels (GitHub issue, in-app, F-Droid warning) still work.

## Responsibility

Relevance is a tool. It stores no APKs and runs no builds itself; users build and publish under
their own GitHub account and are responsible for what they build.
