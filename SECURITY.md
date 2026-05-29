# Security policy

## Trust model

`@atom-circuit/embed-sdk` ships an iframe served from `https://atomcircuit.net` into a host page. The iframe is treated as an independent security principal: the SDK never reads anything from the iframe's DOM and never exposes host-page state to the iframe beyond the `referralId` it places in the URL.

## Origin validation

The SDK enforces strict origin equality on every postMessage:

- Penpal's `WindowMessenger` is configured with `allowedOrigins: ['https://atomcircuit.net']`.
- A second `MessageEvent` listener double-checks `event.origin === 'https://atomcircuit.net'` AND `event.source === iframe.contentWindow` before dispatching any stream event to host-side subscribers.

No wildcard origin (`*`) is ever used. Hosts that need to point at a staging build during local development can override the origin via the `origin` option; this also retargets the postMessage allow-list, so the trust boundary stays explicit.

## Sandbox

The iframe is created with:

```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
```

`allow-top-navigation` is intentionally omitted. The iframe cannot navigate the host page, which removes the most common clickjacking attack vector. `allow-same-origin` is required so the host's browser extension wallets (Keplr, Leap, Cosmostation) can inject `window.keplr` and similar into the iframe; the SDK does not relax this to grant additional capability.

## Clickjacking trust boundary

The host page is fully responsible for protecting the iframe from clickjacking. Concretely, the host should:

- Set `Content-Security-Policy: frame-ancestors` on its own origin to whatever ancestry policy makes sense for the host site (the SDK cannot do this on the host's behalf).
- Avoid overlaying transparent UI on top of the widget. The SDK does not detect such overlays.
- Consider serving the embedding page over HTTPS only; mixed-content rules will already block the widget on HTTP pages.

The iframe origin (`atomcircuit.net`) sets its own `Content-Security-Policy` to control what ancestors may embed it, and uses `X-Frame-Options` plus `Permissions-Policy` to constrain the widget's surface.

## CDN integrity (Subresource Integrity)

When loading the IIFE bundle from a public CDN (such as unpkg) instead of installing via npm, pin the file with a SHA-384 Subresource Integrity hash and the `crossorigin="anonymous"` attribute. This way a CDN compromise cannot ship a different SDK to your visitors.

Compute the hash against the artifact that was published:

```sh
openssl dgst -sha384 -binary dist/atom-circuit.iife.js | openssl base64 -A
```

Use the output in the `<script>` tag:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js"
  integrity="sha384-e0EM289L42Rs5yaVi2w+xv5Pwr6rAK9tLh5caDpIW5ADmulSQ97R3CXxC7T/R7D/"
  crossorigin="anonymous"
></script>
```

If the bytes do not match, the browser refuses to execute the script. Operators rotating a release update the hash on every `<script>` tag they control.

## Bundled dependencies

The only runtime dependency is `penpal` (MIT), pinned to the `7.0.x` range. No GPL or other copyleft dependency ships in the published artifacts.

## Scope

In scope for this policy:

- The SDK source under `src/` and the published artifacts under `dist/` (npm + IIFE).
- The postMessage protocol surface (handshake, resize, widget event stream).
- Origin and source-window validation in `IframeClient`.
- Theme + chrome validation in `src/theme.ts`.
- Sandbox attributes applied by `mount()`.

Out of scope:

- The Atom Circuit dapp that runs inside the iframe (report to that repository's security policy).
- Wallet extensions injected via `allow-same-origin` (report to the wallet vendor).
- Misconfiguration on the host site (CSP, `frame-ancestors`, transport security).
- Build-time tooling and test fixtures (`tsup`, `vitest`, `playwright`).

## Reporting

Two channels:

1. **GitHub Security Advisories** (preferred): open a private advisory under the repository's Security tab via "Report a vulnerability". This gives us a private, auditable conversation without exposing the issue to the public.
2. **Email**: send a report to `security@atomcircuit.net`. If you would like the report encrypted, request the maintainer's PGP key in your first message and attach a key of your own; the project's PGP fingerprint is `<TO_BE_INSERTED_BY_OPERATOR>` (operator to insert real fingerprint).

Include enough detail to reproduce the issue. We will acknowledge within 72 hours and aim to ship a fix or mitigation within 14 days for high-severity issues.

Do NOT open a public GitHub issue for an unpatched vulnerability.
