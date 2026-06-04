# Security policy

## Trust model

`@atom-circuit/embed-sdk` ships an iframe served from `https://atomcircuit.net` into a host page. The iframe is treated as an independent security principal: the SDK never reads anything from the iframe's DOM and never exposes host-page state to the iframe beyond the `referralId` it places in the URL.

## Origin validation

The SDK enforces strict origin equality on every postMessage:

- Penpal's `WindowMessenger` is configured with `allowedOrigins: ['https://atomcircuit.net']`.
- A second `MessageEvent` listener double-checks `event.origin === 'https://atomcircuit.net'` and `event.source === iframe.contentWindow` before dispatching any stream event to host-side subscribers.

No wildcard origin (`*`) is ever used. Hosts that need to point at a staging build during local development can override the origin via the `origin` option; this also retargets the postMessage allow-list, so the trust boundary stays explicit.

## Sandbox

The iframe is created with:

```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
```

`allow-top-navigation` is intentionally omitted. The iframe cannot navigate the host page, which removes the most common clickjacking attack vector. `allow-same-origin` is required so the host's browser extension wallets (Keplr, Cosmostation) can inject `window.keplr` and similar into the iframe; the SDK does not relax this to grant additional capability.

## Clickjacking trust boundary

The host page is fully responsible for protecting the iframe from clickjacking. Concretely, the host should:

- Set `Content-Security-Policy: frame-ancestors` on its own origin to whatever ancestry policy makes sense for the host site (the SDK cannot do this on the host's behalf).
- Avoid overlaying transparent UI on top of the widget. The SDK does not detect such overlays.
- Consider serving the embedding page over HTTPS only; mixed-content rules will already block the widget on HTTP pages.

The iframe origin (`atomcircuit.net`) sets its own `Content-Security-Policy` to control what ancestors may embed it, and uses `X-Frame-Options` plus `Permissions-Policy` to constrain the widget's surface.

## Parent-page wallet bridge trust model

The optional `wallet` option (`wallet.mode: 'parent'`) lets the embedded widget reuse the wallet already connected on the host page (Cosmos via [@dao-dao/cosmiframe](https://github.com/DA0-DA0/cosmiframe), EVM via a custom `postMessage` EIP-1193 relay). The trust model:

- **Keys never leave the user's wallet.** The wallet lives on the host page. The iframe builds the swap transaction and requests a signature over `postMessage`; the host relays the request to the wallet, which shows its own confirmation UI; the iframe never holds keys or a signer. Only request/response envelopes (and offline-signer method calls, on the Cosmos side) cross the bridge - never private key material.
- **The user's own wallet UI is the authoritative backstop.** The amounts and recipients displayed inside the iframe are advisory. A malicious or compromised parent page could tamper with a sign request at the relay layer before the wallet sees it, so the value the user actually approves is the one shown in their own wallet's confirmation dialog. Users should always verify the transaction in their wallet, not in the embedded UI.
- **Origin trust via the unspoofable embedding origin.** The SDK runs in the embedder's page and stamps that page's real `window.location.origin` into the iframe URL as `parentOrigin`; the widget trusts that single origin for the bridge. The browser, not the page, supplies the origin on every postMessage, so an arbitrary site cannot impersonate the embedder's origin and bridge a victim's wallet. A forged `parentOrigin` simply produces a bridge no real parent can satisfy, so it fails closed. Enforcement is the per-message checks below, not any secret.
- **Per-message origin + source validation.** Both wallet channels validate `event.origin` and `event.source` on every inbound message before it touches the wallet, and every outbound message targets a specific origin, never `'*'`. Cosmiframe enforces this natively on both sides; the EVM relay (`atomcircuit:evm` envelope) replicates it and additionally shape-validates every envelope (namespace, kind, string id, string method) before relaying. The Cosmos child is never constructed with a wildcard origin or the cosmiframe `UNSAFE_ALLOW_ANY_ORIGIN` sentinel.
- **Graceful, fail-closed fallback.** If no parent wallet is present, the wallet is unsupported, or the handshake times out, the widget falls back to in-iframe connect. The bridge is never silently widened on failure.

### A note on cosmiframe's `cosmiframe_keystorechange` listener

The Cosmos channel rides on [@dao-dao/cosmiframe](https://github.com/DA0-DA0/cosmiframe). Cosmiframe attaches a native `cosmiframe_keystorechange` `window` message listener inside the iframe that is not origin-validated (it reacts to a bare `event.data === 'cosmiframe_keystorechange'` regardless of `event.origin`). This is library behaviour, not something the SDK configures, and the impact is low: the signal carries no payload and cannot inject an account. It only prompts the iframe to re-read the active account through the origin-validated cosmiframe channel (the same `getKey` / `getAccount` path that is already origin and source checked end to end). A page that fires the bare keystorechange message can at most make the iframe re-query the account it would have queried anyway; it cannot supply, swap, or forge an account, and it cannot forge or alter a signature (every sign request still crosses the origin-validated channel and is approved in the user's own wallet UI). This is documented for completeness rather than as an exploitable surface; a future cosmiframe release that origin-scopes the listener is the clean fix and requires no SDK change.

A `frame-ancestors` CSP scoped per integrator is a known deferred item: allowed embedding origins are dynamic across integrator sites, so a single static edge header cannot express them. For this release the signing boundary is enforced by the per-message origin + source checks plus the user's own wallet confirmation (the authoritative backstop above). The residual not covered by deferring that CSP is clickjacking, which cannot forge a signature; it is revisited as integrator count grows.

## CDN integrity (Subresource Integrity)

When loading the IIFE bundle from a public CDN (such as unpkg) instead of installing via npm, pin the file with a SHA-384 Subresource Integrity hash and the `crossorigin="anonymous"` attribute. This way a CDN compromise cannot ship a different SDK to your visitors.

Compute the hash against the artifact that was published:

```sh
openssl dgst -sha384 -binary dist/atom-circuit.iife.js | openssl base64 -A
```

Use the output in the `<script>` tag:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"
  integrity="sha384-rZ29F2zRBfHEVxJldYGp/+NjMEXyVfDbGB9ifxpw0kub3yQoAWxYKeYbn7t42mBe"
  crossorigin="anonymous"
></script>
```

If the bytes do not match, the browser refuses to execute the script. Integrators rotating to a new release update the hash on every `<script>` tag they control.

## Bundled dependencies

The runtime dependencies are `penpal` (MIT), pinned to the `7.0.x` range, and `@dao-dao/cosmiframe` (`^1.0.0`), used only by the parent-side Cosmos wallet bridge. No GPL or other copyleft dependency ships in the published artifacts.

## Scope

In scope for this policy:

- The SDK source under `src/` and the published artifacts under `dist/` (npm + IIFE).
- The postMessage protocol surface (handshake, resize, widget event stream).
- Origin and source-window validation in `IframeClient`.
- Theme + chrome validation in `src/theme.ts`.
- Sandbox attributes applied by `mount()`.
- The parent-side wallet bridge in `src/wallet-bridge.ts` (Cosmos + EVM channels) and its origin/source/shape validation.

Out of scope:

- The Atom Circuit dapp that runs inside the iframe (report to that repository's security policy).
- Wallet extensions injected via `allow-same-origin` (report to the wallet vendor).
- Misconfiguration on the host site (CSP, `frame-ancestors`, transport security).
- Build-time tooling and test fixtures (`tsup`, `vitest`, `playwright`).

## Reporting

Two channels:

1. **GitHub Security Advisories** (preferred): open a private advisory under the repository's Security tab via "Report a vulnerability". This gives us a private, auditable conversation without exposing the issue to the public.
2. **Email**: send a report to `contact@cosmosrescue.com`.

Include enough detail to reproduce the issue.

Do not open a public GitHub issue for an unpatched vulnerability.
