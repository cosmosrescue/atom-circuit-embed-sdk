# @atom-circuit/embed-sdk

Embed the [Atom Circuit](https://atomcircuit.net) swap widget on any website. Every swap routed through the widget carries a `referralId` so the 0.5% affiliate fee is converted to ATOM and staked to a Cosmos Hub validator chosen by the host site.

- License: MIT
- Bundles: ESM, CJS, IIFE
- Release notes: [CHANGELOG.md](./CHANGELOG.md).

## Install

For React, Next.js, or any bundled project:

```sh
npm install @atom-circuit/embed-sdk
```

For static sites that do not bundle, load the IIFE from a CDN with a pinned Subresource Integrity hash:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js"
  integrity="sha384-e0EM289L42Rs5yaVi2w+xv5Pwr6rAK9tLh5caDpIW5ADmulSQ97R3CXxC7T/R7D/"
  crossorigin="anonymous"
></script>
```

Each release publishes its hash on the [GitHub release page](https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases). Bump the version pin and the `integrity` value together. Recipe for computing the hash yourself is under [Security](#security).

## Getting your referral ID

Open your validator page on [atomcircuit.net](https://atomcircuit.net). The referral ID is shown next to your referral link with a Copy button. Either the raw referral ID or your registered validator slug works as `referralId`; both resolve to the same on-chain validator.

If you do not represent a validator (community sites, ecosystem aggregators, content creators, podcast hosts) you can still embed the widget. Use `referralId: 'general'` to split the affiliate fee equally across all participating validators (registered Atom Circuit validators that have received at least one swap attribution). The `referralId` option is **optional** since v1.1.0 - omitting it defaults to `'general'`, so the minimal install is literally one `mount()` call with no options.

## Quick start

Pick the stack you ship with. Replace `YOUR_REFERRAL_ID` with the value from your validator profile (or the literal string `general`). Every other field is optional.

### Vanilla HTML

```html
<div id="atom-circuit-widget"></div>
<script src="https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js"></script>
<script>
  AtomCircuit.mount(document.getElementById('atom-circuit-widget'), {
    referralId: 'YOUR_REFERRAL_ID',
  });
</script>
```

For production, use the SRI-pinned form from [Install](#install).

### React

```tsx
import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';

export function SwapPanel() {
  return <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />;
}
```

### Next.js (App Router)

The SDK is iframe-only at runtime; skip the server bundle with `next/dynamic`:

```tsx
'use client';
import dynamic from 'next/dynamic';

const AtomCircuitSwap = dynamic(
  () => import('@atom-circuit/embed-sdk/react').then((m) => m.AtomCircuitSwap),
  { ssr: false }
);

export default function Page() {
  return <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />;
}
```

That is the entire integration. The rest of this README documents what is configurable and how the trust boundary works. Each stack has a fully-wired example under [`examples/`](./examples/) that shows every option and every callback.

## Full examples

Each stack has a fully-wired example that demonstrates every option and every callback:

- Vanilla HTML: [examples/vanilla-html/full.html](./examples/vanilla-html/full.html)
- React: [examples/react/full.tsx](./examples/react/full.tsx)
- Next.js: [examples/nextjs/full.tsx](./examples/nextjs/full.tsx)

## API surface

`mount` (vanilla) and `<AtomCircuitSwap />` (React) expose the same options.

### `mount(container, options)`

```ts
const { iframe, wrapper, client, destroy } = AtomCircuit.mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  // sizing - all optional
  width: '100%',
  maxWidth: '480px',
  minHeight: '520px',
  padding: '16px',
  // appearance - all optional
  theme: { mode: 'dark', accentColor: '#7b61ff', radius: 12 },
  chrome: { logo: true, wallet: true, validator: true, footer: true },
  // callbacks - all optional
  onReady:         ({ protocolVersion }) => {},
  onResize:        ({ height })          => {},
  onSwapSubmitted: ({ txHash, route })   => {},
  onSwapSuccess:   ({ txHash })          => {},
  onSwapError:     ({ code, message })   => {},
  onError:         ({ code, message })   => {},
});
```

Call `destroy()` when the host removes the widget from the DOM. The returned `wrapper` is the always-present `<div data-atom-circuit-embed>` containing the iframe and the loading overlay.

### `<AtomCircuitSwap />`

Same options as `mount`, expressed as React props. Re-mounts the iframe only when `referralId`, `origin`, or `path` change; changing `theme`, `chrome`, `width`, `maxWidth`, `padding`, or `minHeight` after the initial mount is a silent no-op so a stylistic tweak does not drop the user's wallet session. To force a re-mount (and accept the wallet session drop), bump a `key=` on the component.

## Theming

The host SDK is the trust boundary. The theme passes through strict validation, is serialised as compact JSON, and is forwarded to the iframe as a base64-encoded `?theme=` URL parameter. The iframe decodes the validated subset and applies it as CSS custom properties.

| Key            | Type                          | Range / format                                          |
| -------------- | ----------------------------- | -------------------------------------------------------- |
| `mode`         | `'light' \| 'dark' \| 'auto'` | -                                                        |
| `accentColor`  | hex string                    | `#abc` or `#aabbcc`                                      |
| `background`   | hex string                    | as above                                                 |
| `foreground`   | hex string                    | as above                                                 |
| `border`       | hex string                    | as above                                                 |
| `radius`       | number                        | px, 0-64 inclusive                                       |
| `fontSize`     | number                        | px, 8-32 inclusive                                       |
| `fontFamily`   | string                        | CSS-safe subset, no `<>;{}=()`, no newlines, max 200ch   |

Every field is optional. If any single field fails validation the entire theme is dropped and the widget renders with its defaults; the SDK emits one `console.warn` describing the failure. The widget does not download fonts, so use a `fontFamily` already loaded on the host page.

Source: [`src/theme.ts`](./src/theme.ts) for validation, [`src/protocol.ts`](./src/protocol.ts) for the `ThemeOptions` type.

### Chrome toggles

Hide individual surfaces inside the embed without restyling:

```ts
chrome: {
  logo: false,      // Atom Circuit logo (top-left)
  wallet: false,    // Connect Wallet button (top-right)
  validator: false, // "Fees stake with <moniker>" badge row
  footer: false,    // bottom links / help footer
}
```

Each flag defaults to `true`. A non-boolean drops the entire `chrome` bundle.

### Sizing

- `width`: any CSS width. Default `'100%'`.
- `maxWidth`: any CSS max-width. Default unset.
- `padding`: applied to the wrapper, not the iframe. Default `'0'`.
- `minHeight`: starting iframe height before the widget reports its content size. Default `'480px'`.

The runtime iframe height is managed by the SDK's resize handler and cannot be overridden.

## Callbacks

| Event             | Fires when                                                                            | Payload                          |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| `onReady`         | iframe handshake completes; from here the widget is interactive                       | `{ protocolVersion }`            |
| `onResize`        | iframe content height changes                                                          | `{ height }` in px               |
| `onSwapSubmitted` | user signed and the source-chain tx broadcast                                          | `{ txHash, route }`              |
| `onSwapSuccess`   | cross-chain delivery confirmed by the indexer                                          | `{ txHash }` (source-chain hash) |
| `onSwapError`     | swap failed inside the iframe or the wallet rejected the signature                     | `{ code, message }`              |
| `onError`         | SDK-level failure: handshake timeout, iframe load failure, origin mismatch, protocol  | `{ code, message, cause }`       |

`onError` covers widget bring-up failures; `onSwapError` covers in-flow swap failures. They are separate so a host can wire different UI for each.

`onError` codes are stable strings: `handshake_failed`, `iframe_load_failed`, `origin_mismatch`, `protocol_incompatible`, `unknown`. If `onError` is not supplied, the SDK logs a single `console.warn` and continues. Nothing is thrown.

### Capability negotiation

The iframe advertises capabilities during the handshake. Probe before relying on one:

```ts
const result = AtomCircuit.mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  onReady: () => {
    if (result.client.has('swap.submit')) {
      // safe to use programmatic submit
    }
  },
});
```

`client.has(name)` returns `false` before the handshake completes and for any capability the iframe did not advertise. Names are case-sensitive.

## Persisting across route changes

React Router and most SPA routers unmount route-level components when the visitor navigates away. The default behavior is: visitor lands on `/swap`, the widget mounts, the loading spinner runs, the handshake completes. They navigate to `/about`, the widget unmounts (iframe destroyed). They return to `/swap`, the widget remounts from scratch with a fresh spinner. Their wallet session survives via iframe-side browser storage, but in-progress swap state (selected tokens, typed amounts, fetched route) is lost.

Three patterns to handle this:

### Pattern 1 - React layout hoist (recommended for React SPAs)

Mount `<AtomCircuitSwap />` once in a top-level layout that does not unmount across route changes. Toggle CSS visibility per route:

```tsx
'use client';
import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';
import { usePathname } from 'next/navigation';

export function PersistentSwap() {
  const pathname = usePathname();
  return (
    <div style={{ display: pathname === '/swap' ? 'block' : 'none' }}>
      <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />
    </div>
  );
}
```

The widget stays mounted across navigations; only `display` toggles. Wallet AND form state preserved. Trade-off: the iframe + dapp instance stays in memory on every page.

### Pattern 2 - imperative mount once

Use `AtomCircuit.mount()` directly into a persistent DOM container outside the router-managed area. Show or hide via CSS:

```html
<div id="atom-circuit-widget" style="display: none;"></div>
<script src="https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js"></script>
<script>
  AtomCircuit.mount(document.getElementById('atom-circuit-widget'), {
    referralId: 'YOUR_REFERRAL_ID',
  });
  function showSwap() {
    document.getElementById('atom-circuit-widget').style.display = 'block';
  }
  function hideSwap() {
    document.getElementById('atom-circuit-widget').style.display = 'none';
  }
</script>
```

The vanilla `mount()` lifecycle is not tied to React. Same trade-off as Pattern 1: persistent memory cost in exchange for state preservation.

### Pattern 3 - accept the reload

Zero extra code. Re-handshake on every visit takes 1-3 seconds with the loading spinner. Appropriate when the swap page is the destination rather than a sidebar - which is how Stripe Elements, Mapbox demos, and most embedded widget previews work.

## Loading state

The wrapper renders a centered spinner overlay during the iframe handshake (typically 1-3s on a warm cache). The overlay fades out on the first `ready` event and is also dismissed if `onError` fires, so a permanent handshake failure never leaves a forever-spinning state. No flash of blank container while the iframe is fetching the dapp bundle.

## Security

The widget runs inside a sandboxed iframe served from `atomcircuit.net`. It cannot read or write the host page's DOM, cookies, or storage. All host/iframe traffic goes over `postMessage` with origin validation on both sides.

### Subresource Integrity for CDN consumers

Current SRI hash for `1.1.1`:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js"
  integrity="sha384-e0EM289L42Rs5yaVi2w+xv5Pwr6rAK9tLh5caDpIW5ADmulSQ97R3CXxC7T/R7D/"
  crossorigin="anonymous"
></script>
```

Verify the hash yourself:

```sh
curl -sL https://unpkg.com/@atom-circuit/embed-sdk@1.2.0/dist/atom-circuit.iife.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Each release publishes a fresh hash on the [GitHub release page](https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases); bump the version pin and the `integrity` value together. See [SECURITY.md](./SECURITY.md) for the disclosure channel and the full trust boundary.

### Sandbox attributes

```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
```

`allow-same-origin` is required so Keplr can inject `window.keplr`. `allow-popups` and its escape variant let wallet popups (Keplr, Leap, Cosmostation) open. `allow-top-navigation` is intentionally omitted to limit clickjacking surface.

### Chrome storage partitioning (115+)

Chromium 115+ partitions iframe storage by `(iframe origin, top-level site)`. A user who connected their wallet on `validatorA.com` will need to reconnect on `validatorB.com`; each host gets its own isolated wallet session inside the widget.

## Versioning

- The npm package follows semver. Major bumps signal a breaking change to `mount()` or `<AtomCircuitSwap />`.
- The iframe wire protocol version (`PROTOCOL_VERSION`, currently `1.0.0`) is independent of the npm package version. SDK and iframe negotiate at handshake time; a major mismatch surfaces as `onError` with `code: 'protocol_incompatible'`.

## Compatibility

- React: `>=17 <20` (peer dependency, optional).
- Modern evergreen browsers, ES2020 baseline. Tested: Chromium 115+, Firefox 115+, Safari 16+.
- Desktop browser extensions (Keplr, Leap, Cosmostation) are the primary wallet path. Mobile WalletConnect inside an iframe has documented iOS Safari issues.
- Node.js `>=20` for development of this package.
- No GPL or other non-permissive runtime dependencies.

## Cosmiframe coexistence

The Atom Circuit dapp loads [Cosmiframe](https://github.com/DA0-DA0/cosmiframe) for an unrelated integration. When the embedded widget runs on a host page, Cosmiframe logs `Failed to detect Cosmiframe parent of allowed origin` to the browser console. This is non-blocking noise from the dapp side; the swap widget itself functions normally and your `onReady` / `onSwap*` callbacks fire as expected.

## License

MIT. See [LICENSE](./LICENSE).
