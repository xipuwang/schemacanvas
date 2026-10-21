# SchemaCanvas release: GitHub Pages

Status: **release candidate, not created, pushed or published.** The steps under "One-time setup" run only after the owner approves them.
Nothing in this repository creates a remote, pushes, publishes or changes repository visibility by itself.

## Decisions

| Item | Decision |
|---|---|
| Version | `v0.1.0` (`0.1.0`), public beta. The tag points at the GitHub Pages deployment commit (see "History") |
| Repository | ONE public repository, `xipuwang/schemacanvas`, for the source code and the GitHub Pages site |
| Site | `https://xipuwang.github.io/schemacanvas/` (project site, base path `/schemacanvas/`) |
| Licence | All Rights Reserved. No licence is granted: the repository is viewable, not reusable. Third-party licences ship in `THIRD-PARTY-NOTICES.txt` |
| Security headers | GitHub Pages cannot send them. The strict CSP and the referrer policy are build-time `<meta>` tags; the rest is impossible on this host (table below) |
| Deployment | GitHub Actions workflow `.github/workflows/pages.yml`, from `main`. No Cloudflare configuration is used |

## What ships

`dist/` (97 files, listed with SHA-256 in [release/MANIFEST.txt](release/MANIFEST.txt)):
- `index.html`: the app, with the meta CSP and referrer meta injected at build time.
- `404.html`: GitHub Pages serves it with status 404 for any unknown path under `/schemacanvas/`. A missing asset is never answered with `index.html`, which would then be cached as immutable, and a deep link such as `/schemacanvas/a/b` gets a clear page instead of a broken shell. It links back to `/schemacanvas/`.
- `THIRD-PARTY-NOTICES.txt`: licence texts of the 28 bundled components. Reachable at `/schemacanvas/THIRD-PARTY-NOTICES.txt`.
- `assets/`: content-hashed JS, CSS and woff2 files, with the ELK worker.

Every asset URL is under `/schemacanvas/`. `npm run check:dist` fails on a `_headers`, `_redirects` or `wrangler.toml` file, because those are host configuration that GitHub Pages does not read.

The build is reproducible: the same `package-lock.json` and Node 26 give byte-identical files, so a fresh build can be checked against the committed manifest.

## Security headers on GitHub Pages

| Protection | Status on GitHub Pages | How |
|---|---|---|
| Content-Security-Policy | **enforced** (meta) | `<meta http-equiv="Content-Security-Policy">` injected by `scripts/vite-csp.ts`, with the hashes of the inline scripts computed at build time. Policy: `default-src 'none'; script-src 'self' 'sha256-wwe5Wzul+kA7k1+9iAXtg4ABUAjENANxSXrkRfhX4Uk='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'` |
| Referrer-Policy | **enforced** (meta) | `<meta name="referrer" content="no-referrer">` |
| X-Content-Type-Options: nosniff | **depends on GitHub** | Whatever GitHub Pages sends. Check it on the live site (below). It cannot be set by the app |
| `frame-ancestors` / X-Frame-Options (clickjacking) | **impossible** | `frame-ancestors` is ignored in a meta CSP, and the app cannot set X-Frame-Options on GitHub Pages; GitHub Pages is not known to send one (check on the live site) |
| Permissions-Policy | **impossible** | header only |
| Cross-Origin-Opener-Policy | **impossible** | header only |
| Custom Cache-Control | **impossible** | GitHub Pages sets its own caching (about 10 minutes) for all files |
| HSTS | **by github.io** | the domain's own setting |
| Unknown paths | **404** | `404.html` is served with status 404 |

The meta CSP is checked at build time: `npm run check:dist` fails if the hash no longer matches the inline script, if a directive that only
works as a header (`frame-ancestors`, `report-uri`, `sandbox`) appears in the meta tag, or if the referrer meta is missing.

Hosts that send headers can add what GitHub Pages cannot: `frame-ancestors 'none'`, `Permissions-Policy`, COOP and the long-lived caching of `/assets/*`.

## Build instructions

Requirements: Node 26 (`.nvmrc`) and npm.

```bash
git clone https://github.com/xipuwang/schemacanvas.git    # or use a clean checkout of the release commit
cd schemacanvas
rm -rf node_modules dist
npm ci
npm run release:build     # 1. regenerate notices   2. typecheck + vite build (base /schemacanvas/)   3. publish gate
npm run release:verify    # dist/ must match release/MANIFEST.txt byte for byte
```

If `release:verify` reports a difference, do not deploy. Investigate first: a different Node major or lockfile, or a local change.
To build for another base path, set `SC_BASE` (for example `SC_BASE=/ npm run build` for a domain root). The release is built for `/schemacanvas/`.

## One-time setup and push (only after owner approval)

These commands create a repository on GitHub and publish the source. Run them yourself, after the identity check below.

```bash
# 1. On github.com, create the PUBLIC repository xipuwang/schemacanvas.
#    Do NOT add a README, licence or .gitignore: the first push should be exactly this repository.

# 2. On github.com: Settings > Pages > Build and deployment > Source: "GitHub Actions".

# 3. Locally, from the release commit, add the remote and push the branch and the existing tag.
git remote add origin https://github.com/xipuwang/schemacanvas.git
git push -u origin main
git push origin v0.1.0
```

- The first push to `main` starts the deployment workflow (it builds, verifies and publishes; see "What the workflow does").
- Optional: Settings > Environments > `github-pages` > deployment branches: allow `main` only.

**Identity warning.** Commits and the tag are authored by `Philip Wang <philipwang@uchicago.edu>` (repository-local Git identity). That address becomes public on push.
If it is marked private on GitHub and "Block command line pushes that expose my email" is enabled, the push is **rejected**.
Check https://github.com/settings/emails before the first push.

## What the workflow does

`.github/workflows/pages.yml`, on push to `main` and on `workflow_dispatch`:

1. **Build job**
   - checks out the repository (no persisted credentials);
   - sets up Node from `.nvmrc` (26) with the npm cache;
   - `npm ci`;
   - `npx vitest run --maxWorkers=2` (unit and in-process integration tests);
   - `npm run release:build` (notices, base `/schemacanvas/` build, publish gate);
   - `npm run release:verify` (the fresh `dist/` must match `release/MANIFEST.txt`);
   - configures Pages and uploads `dist/` as the Pages artifact.
2. **Deploy job** publishes the artifact to the `github-pages` environment.

Permissions are `contents: read` for the build, and `pages: write` and `id-token: write` only for the deploy job. A concurrency group `pages` runs one deployment at a time. Every action is pinned to a full commit SHA.

## Verify the live site

Run these after the deployment finishes (the Actions run shows success, and the environment `github-pages` shows the URL).

```bash
# status and content type of the app (GitHub Pages redirects /schemacanvas to /schemacanvas/)
curl -sI https://xipuwang.github.io/schemacanvas/ | grep -i -E '^(HTTP|content-type|x-content-type-options|x-frame-options|cache-control)'

# the meta CSP and the referrer meta are in index.html (expect a count of 1 each)
curl -s https://xipuwang.github.io/schemacanvas/ | grep -c 'http-equiv="Content-Security-Policy"'
curl -s https://xipuwang.github.io/schemacanvas/ | grep -c 'name="referrer"'

# the notices are reachable as plain text
curl -sI https://xipuwang.github.io/schemacanvas/THIRD-PARTY-NOTICES.txt | grep -i -E '^(HTTP|content-type)'

# an unknown path returns 404 (served by 404.html)
curl -sI https://xipuwang.github.io/schemacanvas/does-not-exist | grep -i '^HTTP'

# the production smoke test, real input, three engines (needs: npx playwright install chromium firefox webkit)
node scripts/smoke-prod.mjs all https://xipuwang.github.io/schemacanvas/
```

Record the results (status codes, content types, the header values GitHub sends, the smoke result) in the Verification section below.

## Rollback

A rollback means deploying an earlier version again:
- **Re-run the workflow on an earlier release:** Actions > "Deploy to GitHub Pages" > Run workflow, and choose a branch or tag that points at the earlier release (available from the second release on; v0.1.0 is the first).
  The workflow file must exist at that commit, so commits from before `pages.yml` cannot be deployed this way.
- **Or revert and push:** `git revert <bad commit>` on `main`, then `git push`. The push deploys the reverted tree.

After either, repeat "Verify the live site".

## Manual smoke checklist (live URL)

Open `https://xipuwang.github.io/schemacanvas/` in desktop Chrome, Firefox and Safari. Use a private window, so you start with no stored data.

- [ ] **Load.** The page loads. DevTools shows no console errors, and the Network tab has only same-origin requests and no 404s.
- [ ] **Headers.** The response headers match the table above. `index.html` contains the meta CSP.
- [ ] **Notices.** `https://xipuwang.github.io/schemacanvas/THIRD-PARTY-NOTICES.txt` shows the licence texts as plain text.
- [ ] **Pharmacy example.** Open the Pharmacy example in the ER view, then in the Relational view. The foreign-key arrows end on the referenced cells.
- [ ] **New Chen diagram.**
  - [ ] Create an entity, a weak entity, an identifying relationship and a composite attribute. Validate: no unexpected errors.
  - [ ] Convert to a relational schema. Move a table: the arrows stay on the right cells.
  - [ ] Undo and redo.
- [ ] **Auto-layout.** Run it on the relational sheet: tables move, and there is no console error.
- [ ] **Save and autosave.**
  - [ ] Save `.schemacanvas.json`.
  - [ ] Reload: autosave restores the project.
  - [ ] Open the saved file in another private window: it is identical.
- [ ] **Export.** Export PNG, SVG, PDF, SQL (MySQL and PostgreSQL) and DBML. Each file opens. The SQL has PRIMARY KEY and FOREIGN KEY clauses.
- [ ] **Language and theme.** Switch to 中文 and back, and switch to the dark theme.
- [ ] **Clear local data.** Settings > Clear local data, then reload: nothing comes back.
- [ ] **Narrow window.** At about 800 px wide, every toolbar control is reachable.
- [ ] **Paths.** An unknown path such as `/schemacanvas/nope` returns the SchemaCanvas "Page not found" page with status 404.

## Known limitations

The authoritative list is [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md). The ones most visible to beta users:
- GitHub Pages sends no security headers beyond what the meta tags provide (see "Security headers on GitHub Pages").
- The PDF embeds the page as an image when labels are non-Latin.
- SQL text rules are strict: unusual expressions are refused with an error instead of being emitted.
- Only Chromium runs the full browser suite. Firefox and WebKit run the acceptance suite, and real Safari still needs the manual check above.
- MySQL output assumes the utf8mb4 character set.
- Some messages stay in English in the Chinese UI.
- There is no collaboration or cloud storage; projects stay in the browser and in files you save.

## Verification (v0.1.0)

Results for the GitHub Pages release candidate of v0.1.0. Each row names the command that produced the result.

| Gate | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | 0 errors |
| Unit + integration | `npx vitest run` | **2281 passed, 0 failed** |
| Release build + publish gate | `npm run release:build` | OK: 97 files. Base `/schemacanvas/`; meta CSP pins the inline script; `404.html` present |
| Manifest | `npm run release:verify` | OK: `dist/` matches `release/MANIFEST.txt` |
| Linux, CI-equivalent | Docker, Node 26 (26.12.1), the same gates as the workflow | 2281 unit tests passed; `dist/` byte-identical to `release/MANIFEST.txt` (97 files) |
| Workflow lint | `actionlint` | clean |
| Dependencies | `npm audit`, `npm audit --omit=dev` | 0 vulnerabilities |
| Production smoke, real input | `node scripts/smoke-prod.mjs <engine> http://127.0.0.1:<port>/schemacanvas/` | **29/29 steps** in chromium, firefox and webkit; 0 CSP violations; 0 console problems |
| Performance, hosting | `PERF_MODE=preview` and `PERF_MODE=subfolder npm run e2e:perf` | 5/5 in each mode |
| Real MySQL 8.4 | `INTEGRATION_MYSQL=1 npx vitest run src/integration/p4-mysql.test.ts` | **46/46 passed** |
| Real PostgreSQL 14 | `INTEGRATION_PG=1 npx vitest run src/integration/p4-pg.test.ts` | **7/7 passed** |
| Browser, full suite (Chromium) | `npx playwright test` | **365/365 passed** (19.0 min) |
| Cross-browser acceptance | `npm run e2e:cross` | **88/88 passed** (Firefox 44 + WebKit 44, 8.4 min) |

## History

The public history starts with a single commit, the v0.1.0 release, which contains the application and its GitHub Pages
deployment configuration. The annotated `v0.1.0` tag points at that commit, which is the build that is published. Later
releases are new commits on `main` with their own tags.
