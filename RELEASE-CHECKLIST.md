# SchemaCanvas release checklist (GitHub Pages)

Run this for every public release. A box is ticked only when the command ran in this checkout and passed; record the numbers in
[RELEASE.md](RELEASE.md), section "Verification (v0.1.0)". The deployment itself is done by the GitHub Actions workflow `.github/workflows/pages.yml`; the one-time
setup, the live-site checks and the rollback are in [RELEASE.md](RELEASE.md). Nothing in this repository deploys or publishes anything
by itself; the last section is the owner's.

## 1. Owner decisions (manual, once)

- [ ] **Licence: All Rights Reserved** (decided for v0.1.0). There is no `LICENSE` file by design and no `"license"` field in `package.json`;
      do not add one unless the owner decides to grant a licence. Third-party licences ship in `THIRD-PARTY-NOTICES.txt`.
- [ ] **Version set.** `package.json` `"version"` is `0.1.0`, and the annotated tag `v0.1.0` exists on the commit being published (`git tag -n v0.1.0`).
- [ ] **Hosting:** GitHub Pages, project site `https://xipuwang.github.io/schemacanvas/` from the public repository `xipuwang/schemacanvas`.
      The site cannot send custom headers; see the table in README "Security headers on GitHub Pages".
- [ ] **Author identity checked.** Every commit and the tag are by `Philip Wang <philipwang@uchicago.edu>` (repository-local Git config); that email becomes public on push. Check https://github.com/settings/emails (see RELEASE.md, "One-time setup and push", Identity warning).

## 2. Clean build and publish gate

```bash
rm -rf node_modules dist
npm ci
npm run release:build      # notices -> typecheck + vite build (base /schemacanvas/) -> scripts/check-dist.mjs
```

- [ ] `npm ci` succeeds with no `npm audit` findings: `npm audit` and `npm audit --omit=dev` both report 0 vulnerabilities.
- [ ] `release:build` ends with `OK: base /schemacanvas/; meta CSP pins the inline script; ...; notices and 404 page present.`
      It fails on a host configuration file (`_headers`, `_redirects`, `wrangler.toml`) in `dist/`.
- [ ] `npm run release:manifest` (once per release, committed as `release/MANIFEST.txt`); afterwards `npm run release:verify` proves any
      fresh build is byte-identical to the release.
- [ ] Note the printed CSP hash. It changes whenever the inline script in `index.html` changes; the meta CSP is generated, so no edit is needed by hand.
- [ ] `node scripts/bundle-size.mjs`: the initial JS should stay at or below 250 KB gzip.

## 3. Automated verification

| Tier | Command | Pass criterion |
|---|---|---|
| Type-check | `npm run typecheck` | 0 errors |
| Unit + integration | `npx vitest run --maxWorkers=4` | 0 failed. On a heavily loaded machine, timing guards can time out; rerun the file alone before calling it a failure (docs/TESTING.md) |
| Browser, full | `npm run test:e2e` | all passed (Chromium, about 16-20 min) |
| Cross-browser acceptance | `npm run e2e:cross` | all passed (Firefox + WebKit; needs `npx playwright install firefox webkit`) |
| Production smoke (real input) | `npm run serve:dist` in one terminal, then `node scripts/smoke-prod.mjs all http://127.0.0.1:4173/schemacanvas/` | 29/29 steps in each engine, 0 console problems, 0 CSP violations |
| Performance, hosting | `E2E_PORT=5223 PERF_MODE=preview npm run e2e:perf` and `E2E_PORT=5223 PERF_MODE=subfolder npm run e2e:perf` | 5/5 in each mode |
| Real MySQL (optional, recommended) | start a container, then `INTEGRATION_MYSQL=1 npx vitest run src/integration/p4-mysql.test.ts` | all passed |
| Real PostgreSQL (optional) | `INTEGRATION_PG=1 npx vitest run src/integration/p4-pg.test.ts` | all passed |

MySQL container used for the tier, removed afterwards:
`docker run -d --rm --name schemacanvas-mysql -e MYSQL_ROOT_PASSWORD=sc -e MYSQL_DATABASE=sc mysql:8.4`, then `docker stop schemacanvas-mysql`.

## 4. Manual smoke test of the exact build you will upload

Serve the gated `dist/` the way GitHub Pages serves it: `node scripts/serve-static.mjs dist 4173 /schemacanvas/` (or `npm run serve:dist`).
Then open `http://127.0.0.1:4173/schemacanvas/` in a desktop browser, preferably also real Safari and Firefox:

- [ ] The page loads with no console errors and no failed requests. The Network tab shows only same-origin requests.
- [ ] **Examples dialog:** open Pharmacy. The ER and Relational sheets look right, and the FK arrows end on the referenced cells.
- [ ] **New Chen diagram:**
  - [ ] Add an entity, a weak entity, an identifying relationship and attributes, including a composite attribute.
  - [ ] Validate: no unexpected errors.
  - [ ] Convert, then move a table: the arrows still point at the right cells.
- [ ] **Save and reopen:**
  - [ ] Save a `.schemacanvas.json`.
  - [ ] Reload the page; autosave restores the project.
  - [ ] Open the saved file in a private window; it is identical.
- [ ] **Exports:** PNG, SVG, PDF and SQL (MySQL, PostgreSQL) download and open correctly. Text in the PDF is selectable for Latin text.
- [ ] **Language and theme:** switch to 中文 and back, and switch to dark. Nothing is untranslated apart from user data and SQL.
- [ ] **Clear local data:** Settings > Clear local data, then reload: no project comes back.
- [ ] **Licence notices:** `http://127.0.0.1:4173/schemacanvas/THIRD-PARTY-NOTICES.txt` is reachable.
- [ ] **Narrow window:** at about 800 px wide, and at 200% browser zoom, every toolbar control can be reached.

## 5. Documentation

- [ ] The Verification section of RELEASE.md is updated with today's numbers.
- [ ] The known limitations in docs/KNOWN-LIMITATIONS.md still match the build.
- [ ] README "Status" and "Deployment" are accurate.
- [ ] RELEASE.md matches the release being published (Verification table, live-site checks). Later releases get their own tag (for example `v0.1.1`) on the release commit.
- [ ] Release notes written, for example from the RELEASE.md "Verification" section and docs/KNOWN-LIMITATIONS.md.

## 6. Publish (owner only, after explicit approval)

- [ ] The repository is public only after the owner has checked section 1 (author identity, licence decision).
- [ ] Before the first push, check `.gitignore` and that no local folder is included:
  - `.tmp/`, `.wrangler/` and `e2e/.results*` hold test artefacts and local paths;
  - `.vitest/`, `*.log` and `.tmp_interaction_vite.log` are local output;
  - `node_modules/` and `dist/` are build products.
- [ ] Follow the one-time setup and push commands in [RELEASE.md](RELEASE.md), section "One-time setup". The first push to `main` starts the deployment.
- [ ] Run the live-site checks in RELEASE.md, section "Verify the live site", and the smoke test on `https://xipuwang.github.io/schemacanvas/`.
