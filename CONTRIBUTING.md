# Contributing to @atom-circuit/embed-sdk

Thanks for considering a contribution. This document covers the development
quickstart. 
## Prerequisites

- Node.js `>=20` (CI runs Node 20 and 22).
- npm `>=10` (bundled with Node 20).

## Quickstart

```sh
git clone https://github.com/cosmosrescue/atom-circuit-embed-sdk.git
cd atom-circuit-embed-sdk
npm install
npm run build
npm test
```

That sequence produces:

- `dist/index.mjs` and `dist/index.cjs` for the npm consumers.
- `dist/react.mjs` and `dist/react.cjs` for the React subpath export.
- `dist/atom-circuit.iife.js` for the static-site IIFE.
- All `.d.ts` and `.d.cts` files for TypeScript users.

## Useful scripts

- `npm run build` - tsup builds ESM + CJS + IIFE + types.
- `npm test` - vitest unit suite.
- `npm run test:watch` - vitest in watch mode (use during development).
- `npm run test:e2e` - Playwright cross-origin handshake test. Requires
  `npx playwright install --with-deps chromium` once per machine.
- `npm run typecheck` - `tsc --noEmit`. Run before pushing.
- `npm run size` - size-limit check on the IIFE and ESM bundles.

## Examples

The `examples/` directory contains ready-to-run integrations:

- `examples/vanilla-html` - drop the IIFE into a static page.
- `examples/react` - minimal React app.
- `examples/nextjs` - SSR-safe Next.js usage via `next/dynamic`.

After `npm run build`, you can serve `examples/vanilla-html/index.html`
with any static file server pointing at the repo root.

## Code style

- TypeScript strict mode, no `any` in the public API surface.
- No emojis, em dashes, or en dashes in code, UI, or documentation.
- One responsibility per file; do not refactor unrelated code in a PR.

## Tests

- Vitest + jsdom for unit tests. Place test files in `test/`.
- Playwright covers a single cross-origin handshake happy path in
  `test/e2e/handshake.spec.ts`. Run it locally with `npm run test:e2e`.
- New protocol messages require an `is<Foo>Message` runtime validator plus
  matching tests in `test/protocol.test.ts`.

## Pull requests

1. Open an issue first for any non-trivial change so we can scope it.
2. Keep PRs surgical. One logical change per PR.
3. Update `CHANGELOG.md` if your change is user-visible.
4. Ensure `npm run build`, `npm run typecheck`, `npm test`, and
   `npm run size` all pass locally.
5. CI must be green before merge.

## Cutting a release

The release workflow (`.github/workflows/release.yml`) publishes to npm
with provenance when a `v*` tag is pushed. Steps for the operator:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag with the new version: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Watch the release workflow run. Provenance is attested via OIDC.

## Reporting security issues

See [SECURITY.md](./SECURITY.md). Please do not file public issues for
security-sensitive reports.
