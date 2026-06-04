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
  src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"
  integrity="sha384-rZ29F2zRBfHEVxJldYGp/+NjMEXyVfDbGB9ifxpw0kub3yQoAWxYKeYbn7t42mBe"
  crossorigin="anonymous"
></script>
```

Each release publishes its hash on the [GitHub release page](https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases). Bump the version pin and the `integrity` value together. Recipe for computing the hash yourself is under [Security](#security).

## Getting your referral ID

Open your validator page on [atomcircuit.net](https://atomcircuit.net). The referral ID is shown next to your referral link with a Copy button. Either the raw referral ID or your registered validator slug works as `referralId`; both resolve to the same on-chain validator.

If you do not represent a validator (community sites, ecosystem aggregators, content creators, podcast hosts) you can still embed the widget. Use `referralId: 'general'` to split the affiliate fee equally across all participating validators (registered Atom Circuit validators that have received at least one swap attribution). `referralId` is optional - omit it and the SDK defaults to `'general'`, so the minimal install is one `mount()` call with no options.

## Quick start

Pick the stack you ship with. Replace `YOUR_REFERRAL_ID` with the value from your validator profile (or the literal string `general`). Every other field is optional.

### Vanilla HTML

```html
<div id="atom-circuit-widget"></div>
<script src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"></script>
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
  {
    ssr: false,
    // Reserve the widget's space while the client chunk loads so the page does
    // not shift when the iframe mounts. Match this to your `minHeight`.
    loading: () => <div style={{ minHeight: 520 }} />,
  }
);

export default function Page() {
  return <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />;
}
```

That is the entire integration: a container plus `referralId`, and the end user connects their wallet inside the widget. Nothing else is required.

`referralId` is the only option that affects where fees go, and even it is optional (omit it and the SDK defaults to `'general'`). Everything else - `theme`, `chrome`, `maxWidth`, `allowReferralChoice`, the callbacks, and the parent-wallet bridge - is optional and additive. You can ship the default embed above and never touch any of them. The rest of this README documents what is configurable and how the trust boundary works. Each stack has a fully-wired example under [`examples/`](./examples/) that shows every option and every callback.

## Supported wallets

Which wallets the end user can connect with depends on which of the two connect modes you use. Both are fully supported; the difference is only where the wallet lives.

### Built-in in-widget connect (the default)

This is what you get with a plain embed (no `wallet` option, or `wallet.mode: 'iframe'`): the user connects their wallet inside the widget. The built-in set is fixed:

- **Cosmos:** Keplr and Cosmostation. Each works as a desktop browser extension and on mobile via WalletConnect.
- **EVM:** any injected browser wallet (MetaMask, Rabby, or anything that exposes `window.ethereum`), plus WalletConnect.

### Parent-wallet reuse (advanced, opt-in)

When you opt into parent-wallet mode (`wallet.mode: 'parent'`, see [Reusing the parent page's wallet](#reusing-the-parent-pages-wallet)), the widget reuses whatever wallet is already connected on your page. This is not limited to the built-in set above; it works with any compatible wallet:

- **Cosmos:** any Keplr-API-compatible injected wallet via `fromInjectedCosmosWallet` (any provider exposing `getKey` / `enable` / `getOfflineSigner` / `getOfflineSignerOnlyAmino`), or any connected cosmos-kit wallet client via `fromCosmosKit`. `window.keplr` and `window.cosmostation.providers.keplr` are examples of compatible injected providers, not the only ones; any wallet that implements the same injected API works.
- **EVM:** any EIP-1193 provider via `fromWagmi` (`window.ethereum`, a wagmi connector's resolved provider, or any object with a `request(...)` method).

The user always signs in their own wallet UI; keys never leave their wallet. If the bridge cannot be established, the widget silently falls back to the built-in in-widget connect described above, so a swap is always completable.

## Full examples

Runnable example apps live under [`examples/`](./examples/), organized by language and framework, each with its own README:

- TypeScript, React: [examples/typescript/react](./examples/typescript/react)
- TypeScript, Next.js: [examples/typescript/nextjs](./examples/typescript/nextjs)
- JavaScript, React: [examples/javascript/react](./examples/javascript/react)
- JavaScript, Next.js: [examples/javascript/nextjs](./examples/javascript/nextjs)
- Vanilla HTML: [examples/vanilla](./examples/vanilla)

Each app contains the minimal, full, parent-wallet, and parent-wallet-cosmoskit examples (vanilla covers minimal, full, and parent-wallet).

## API surface

`mount` (vanilla) and `<AtomCircuitSwap />` (React) expose the same options. Exactly one is required:

| Option                   | Required?    | Default     | Purpose                                                              |
| ------------------------ | ------------ | ----------- | -------------------------------------------------------------------- |
| `referralId`             | Optional     | `'general'` | Which validator the affiliate fee stakes to. Omit to split across all participating validators. |
| `allowReferralChoice`    | Optional     | `false`     | Render a validator picker so the end user can change the validator.  |
| `width` / `maxWidth` / `minHeight` / `padding` | Optional | see [Sizing](#sizing) | Layout of the widget wrapper.                              |
| `theme`                  | Optional     | dark preset | Color palette and typography. See [Theming](#theming).               |
| `chrome`                 | Optional     | all visible | Hide individual surfaces (logo, wallet button, validator row, footer). |
| `onReady` / `onResize` / `onSwapSubmitted` / `onSwapSuccess` / `onSwapError` / `onError` | Optional | none | Lifecycle and swap callbacks. See [Callbacks](#callbacks). |
| `wallet`                 | Optional     | `'iframe'`  | Advanced: reuse a wallet already connected on your page. See [Reusing the parent page's wallet](#reusing-the-parent-pages-wallet). |

No option is required: omit everything and the widget mounts in default mode with `referralId: 'general'`, the end user connecting their own wallet inside the iframe. `referralId` is the one option you will almost always set so the fee stakes to a specific validator. The `wallet` option (parent-wallet reuse) is an advanced opt-in covered last.

### `mount(container, options)`

```ts
const { iframe, wrapper, client, destroy } = AtomCircuit.mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  // let the end user pick the validator (default false); referralId is the pre-selected default
  allowReferralChoice: false,
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

Same options as `mount`, expressed as React props. Re-mounts the iframe only when `referralId`, `origin`, `path`, or `wallet.mode` change (those bake into the iframe URL and cannot be applied to a live iframe). Changing `theme`, `chrome`, `width`, `maxWidth`, `padding`, or `minHeight` after the initial mount has no effect, so a stylistic tweak does not drop the user's wallet session. Changing only the wallet handles (`wallet.cosmos` / `wallet.evm`) does not remount; the component diffs handle identity and drives `setWallet` / `clearWallet` under the hood. To force a re-mount (and accept the wallet session drop), bump a `key=` on the component.

### Letting the user choose the validator

By default the host site's `referralId` is fixed and the end user cannot change it. Set `allowReferralChoice: true` to render a validator picker inside the widget: your `referralId` becomes the pre-selected default, the user can switch to any participating validator (or clear it to split across all via `general`), and their choice is remembered across reloads. Leaving it `false` (the default) is fully backwards-compatible - the fixed-`referralId` behaviour is unchanged.

## Reusing the parent page's wallet

This is an advanced, optional feature. You do not need it for a working embed. By default the embedded widget connects its own wallet inside the iframe with no setup: the end user clicks Connect Wallet in the widget even if your page already has a wallet connected. If that default is fine for you, as it is for most integrators, skip this section.

The feature exists for one case: your site already runs a Cosmos (cosmos-kit) or EVM (wagmi) wallet and you want to reuse that connection so the user never reconnects inside the widget. Opting in needs no configuration: set `wallet.mode: 'parent'` and pass at least one wallet handle (`cosmos`, `evm`, or both). The widget trusts the page it is embedded in via the browser's unspoofable parent origin, so the bridge works without registering anything. The user keeps signing every transaction in their own wallet UI - keys never leave their wallet, and the iframe only requests signatures.

This is opt-in and fully backward compatible. Omitting the `wallet` option, or setting `wallet.mode` to `'iframe'` (the default), behaves exactly as before.

### The explicit choice: two modes

The `wallet.mode` field is a deliberate, documented choice you make per embed:

- `'iframe'` (default): the widget connects its own wallet inside the iframe. No bridge, no handles. This is the prior behaviour and the iframe URL is byte-identical to 1.x.
- `'parent'`: the widget reuses your page's already-connected wallet over a postMessage bridge. Requires at least one wallet handle (`cosmos`, `evm`, or both). No configuration: the widget trusts its actual embedding origin, which the browser supplies and a page cannot spoof.

### Cosmos (cosmos-kit and other Cosmos wallets)

Pass `wallet.cosmos`. The simplest path is the `fromCosmosKit` helper, which adapts a connected cosmos-kit wallet client into the handle the bridge needs. In React, derive the client from `useChain()` and wrap it once the wallet is connected:

```jsx
import { useChain } from '@cosmos-kit/react';
import { fromCosmosKit } from '@atom-circuit/embed-sdk';

const { status, chainWallet } = useChain('cosmoshub');

// IMPORTANT: useChain() does NOT return a top-level `client`.
// The wallet client lives at chainWallet.client, and it only exists AFTER connect.
const cosmosClient = chainWallet?.client;

const cosmos = useMemo(
  () => (status === 'Connected' && cosmosClient ? fromCosmosKit(cosmosClient) : undefined),
  [status, cosmosClient]   // key on the client identity - it appears asynchronously after connect
);

return <AtomCircuitSwap referralId="..." wallet={{ mode: 'parent', cosmos }} />;
```

> **Common mistake:** Do not write `const { client } = useChain(...)`. useChain() has no top-level `client`; it is always undefined, so the widget will never adopt the host wallet. The wallet client is `chainWallet.client`.

With the imperative `mount()` API the same handle is built from whatever cosmos-kit client you already have:

```ts
import { mount, fromCosmosKit } from '@atom-circuit/embed-sdk';

// `client` is your connected cosmos-kit wallet client
// (e.g. a ChainWallet's `.client`, populated only after connect).
mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  wallet: {
    mode: 'parent',
    // parent mode trusts the embedding page by its own origin; nothing else to set
    cosmos: fromCosmosKit(client, { metadata: { name: 'My App' } }),
  },
});
```

`fromCosmosKit` reads the client's `getOfflineSignerDirect` / `getOfflineSignerAmino` (falling back to a unified `getOfflineSigner(chainId, signerType)` when that is all the client exposes) and throws at wiring time if the client can produce no signer at all. The Cosmos bridge delegates to [@dao-dao/cosmiframe](https://github.com/DA0-DA0/cosmiframe). It is wallet-agnostic: whatever your cosmos-kit has connected (Keplr, Cosmostation, WalletConnect, etc.) works, and the widget needs no matching wallet package of its own.

#### A raw injected provider (no cosmos-kit): `fromInjectedCosmosWallet`

If you do not run cosmos-kit but a Keplr-API-compatible wallet is injected on your page, adapt the raw provider with `fromInjectedCosmosWallet`. It works for any wallet exposing the Keplr injected API: `window.keplr`, Cosmostation via `window.cosmostation.providers.keplr`, and any other Keplr-compatible injected provider.

```ts
import { mount, fromInjectedCosmosWallet } from '@atom-circuit/embed-sdk';

// window.keplr, or window.cosmostation.providers.keplr, etc.
const provider = window.keplr;
await provider.enable('cosmoshub-4'); // connect on your page first

mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  wallet: {
    mode: 'parent',
    // parent mode trusts the embedding page by its own origin; nothing else to set
    cosmos: fromInjectedCosmosWallet(provider, { metadata: { name: 'My App' } }),
  },
});
```

A raw injected provider exposes `enable` / `getKey` / `sign*` but lacks `connect`, `getAccount`, and `getSimpleAccount` (cosmos-kit normally derives those from `getKey`). `fromInjectedCosmosWallet` wraps the provider into a valid target: it adds a no-op `connect` (the wallet is already connected on your page) and derives `getAccount` / `getSimpleAccount` from `getKey`. Rule of thumb: `fromCosmosKit` for an actual cosmos-kit client, `fromInjectedCosmosWallet` for a raw injected provider.

`fromInjectedCosmosWallet` requires every source chain a swap may use to already be added in the user's wallet. It does not carry a chain-registry dependency to add chains, so if cosmos-kit tries to add a missing chain it surfaces a clear, actionable error ("the wallet does not have `<chainId>` added. Add it in your wallet first, or use fromCosmosKit which can add chains."). If you need to swap from arbitrary source chains the user may not have added, use `fromCosmosKit` (which forwards the real cosmos-kit client's `addChain`).

`fromKeplr` is a backward-compatible alias of `fromInjectedCosmosWallet` (despite the name it accepts any Keplr-compatible provider, including Cosmostation). Prefer `fromInjectedCosmosWallet` in new code; `fromKeplr` is retained and will be removed in a future major.

If you are on neither stack, construct the handle object directly:

```ts
wallet: {
  mode: 'parent',
  // parent mode trusts the embedding page by its own origin; nothing else to set
  cosmos: {
    target: walletClient,                                  // non-signer methods proxied to this
    getOfflineSignerDirect: (chainId) => /* OfflineDirectSigner */,
    getOfflineSignerAmino:  (chainId) => /* OfflineAminoSigner  */,
    metadata: { name: 'My App', imageUrl: 'https://...' }, // optional
  },
}
```

### EVM (wagmi, window.ethereum, any EIP-1193 provider)

Pass `wallet.evm` with an EIP-1193 `provider`. The `fromWagmi` helper takes an already-resolved provider:

```ts
import { mount, fromWagmi } from '@atom-circuit/embed-sdk';

// wagmi exposes the provider via the connected connector; resolve it first:
//   const provider = await getAccount(config).connector.getProvider();
// window.ethereum (or any { request, on?, removeListener? }) also works directly.
mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  wallet: {
    mode: 'parent',
    // parent mode trusts the embedding page by its own origin; nothing else to set
    evm: fromWagmi(provider),
  },
});
```

**Reuse one wallet for both channels:** Keplr also exposes an EVM provider at `window.keplr.ethereum`, so a single Keplr wallet can serve both the Cosmos and EVM channels. Pass `fromWagmi(window.keplr.ethereum)` directly, or with wagmi target Keplr through an `injected` connector (Keplr announces via EIP-6963 with rdns `app.keplr`). A bare `injected()` or `window.ethereum` resolves to MetaMask, or whatever owns `window.ethereum`.

The EVM bridge relays `provider.request(...)` calls to your wallet and forwards its `accountsChanged` / `chainChanged` / `disconnect` events to the widget. `on` / `removeListener` on the provider are optional: when absent the bridge simply relays requests and forwards no push events.

You can pass both `cosmos` and `evm`; the loader wires only the side(s) you supply.

### Connecting after mount (render now, adopt when the wallet connects)

You rarely have a connected wallet at the instant you mount the widget. The recommended flow is to render the widget immediately in `'parent'` mode with no handles, then hand the wallet over the moment your user connects on your page. The widget is visible the whole time and adopts the reused wallet with no remount and no reconnect.

Vanilla `mount()` returns `setWallet` / `clearWallet` for exactly this:

```ts
const widget = mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  wallet: { mode: 'parent' }, // no handles yet
});

// later, once your user connects on your page:
widget.setWallet({ cosmos: fromCosmosKit(client) });
// or pass both: widget.setWallet({ cosmos, evm });

// when your user disconnects on your page:
widget.clearWallet();                 // tear down all bridged channels
// or a single channel: widget.clearWallet(['cosmos']);
```

`setWallet` (re)wires the bridge for the given channel(s) and posts the internal `ready` signal so the iframe auto-adopts the wallet; calling it again with a fresh handle re-adopts cleanly (replace semantics per channel). `clearWallet` tears the channel(s) down and reverts the iframe to its in-iframe connect fallback. Both are no-ops unless the embed was mounted with `wallet.mode === 'parent'`.

In React this is automatic: render `<AtomCircuitSwap wallet={{ mode: 'parent' }} />` first, then pass `wallet.cosmos` / `wallet.evm` on a later render once they exist. The component diffs the handle identity and calls `setWallet` / `clearWallet` for you under the hood, with no remount. Changing `wallet.mode` (it bakes into the iframe URL) does remount; changing only the handles does not.

#### CDN / IIFE build: helpers on the global

The IIFE build exposes the same wallet helpers on the `AtomCircuit` global, so a CDN integrator does not need a bundler to build handles. `AtomCircuit.mount(...)` returns the same `setWallet` / `clearWallet`, and the helpers are available as `AtomCircuit.fromInjectedCosmosWallet` (aliased `AtomCircuit.fromKeplr`), `AtomCircuit.fromCosmosKit`, and `AtomCircuit.fromWagmi`:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"
  integrity="sha384-rZ29F2zRBfHEVxJldYGp/+NjMEXyVfDbGB9ifxpw0kub3yQoAWxYKeYbn7t42mBe"
  crossorigin="anonymous"
></script>
<script>
  var widget = AtomCircuit.mount(document.getElementById('atom-circuit-widget'), {
    referralId: 'YOUR_REFERRAL_ID',
    wallet: { mode: 'parent' }, // no handles yet
    onWalletConnectRequest: function (channel) {
      if (channel === 'cosmos') {
        // Keplr at window.keplr; Cosmostation at window.cosmostation.providers.keplr
        var provider = window.keplr;
        provider.enable(['cosmoshub-4', 'osmosis-1']).then(function () {
          widget.setWallet({
            cosmos: AtomCircuit.fromInjectedCosmosWallet(provider, { metadata: { name: 'My App' } }),
          });
        });
      } else {
        window.ethereum.request({ method: 'eth_requestAccounts' }).then(function () {
          widget.setWallet({ evm: AtomCircuit.fromWagmi(window.ethereum) });
        });
      }
    },
  });
</script>
```

See `examples/vanilla/full.html` for the complete copy-pasteable version.

### In-widget connect button (`onWalletConnectRequest` + `connectPrompt`)

In `'parent'` mode, when a channel is not yet bridged the widget shows a not-connected prompt instead of its own wallet picker (the picker belongs to your page, not the iframe). You decide how that prompt behaves:

- Supply `onWalletConnectRequest(channel)` and the widget renders an actionable Connect button. When the user clicks it, the widget calls your handler with the channel (`'cosmos'` or `'evm'`); you run your own connect flow on the parent page and, on success, call `setWallet` (vanilla) or pass the new handle (React). The widget then adopts it. One handler can service both channels; if a channel is unserviceable, your callback may no-op.
- Omit `onWalletConnectRequest` and the widget shows a passive text prompt instead of a button. Override the text with `connectPrompt` (e.g. `"Connect your wallet at the top of the page to swap"`). When `connectPrompt` is omitted the widget uses a friendly generic default.

```ts
mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  wallet: { mode: 'parent' },
  onWalletConnectRequest: (channel) => {
    // run your own connect UI for `channel`, then on success:
    //   widget.setWallet({ [channel]: handle });
    openMyConnectModal(channel);
  },
  // or, with no handler, a passive prompt:
  // connectPrompt: 'Connect your wallet at the top of the page to swap',
});
```

Both are only meaningful when `wallet.mode === 'parent'`. In React the `onWalletConnectRequest` callback identity may change between renders without forcing a remount - the latest one is always the one invoked.

### Graceful fallback

Reliability is preferred over convenience. In `'parent'` mode, if the bridge cannot be established for any reason - no wallet is connected on the parent, the wallet is unsupported, or the handshake times out - the widget silently falls back to its own in-iframe connect. The user can always complete a swap.

### Trust model

The wallet lives on your page (the connected wallet). The iframe builds the swap transaction and requests a signature over `postMessage`; your page relays it to the wallet, which shows its own confirmation UI; the iframe never holds keys or a signer. The user's own wallet confirmation is the authoritative backstop - the values the iframe displays are advisory, because a compromised parent could tamper at the relay layer, so the user should always verify amounts and recipients in their wallet. The front-line control is the per-message origin check: both channels validate `event.origin` and `event.source` on every message, the iframe only talks to its real parent origin (which the browser supplies and a page cannot spoof), and the Cosmos channel is never constructed with a wildcard origin. See [SECURITY.md](./SECURITY.md) for the full bridge trust model.

## Theming

The host SDK is the trust boundary. The theme passes through strict validation, is serialised as compact JSON, and is forwarded to the iframe as a base64-encoded `?theme=` URL parameter. The iframe decodes the validated subset and applies it as CSS custom properties.

| Key                | Type                          | Controls                                                                 |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `mode`             | `'light' \| 'dark' \| 'auto'` | Which built-in preset to start from. `'dark'` is the default; `'light'` is the light preset; `'auto'` follows the host's system preference. Every token below overrides whichever preset you pick. |
| `accentColor`      | hex string                    | Primary buttons (Swap, Connect) and active highlights. `#abc` or `#aabbcc`. |
| `accentForeground` | hex string                    | Text/icon color rendered on top of the accent (e.g. the primary-button label). |
| `background`       | hex string                    | The widget's outer page background.                                      |
| `foreground`       | hex string                    | Primary text/foreground color.                                           |
| `card`             | hex string                    | Convenience bundle. Sets every surface in one shot: card / panel (`--bg-card`), the secondary panel (`--bg-secondary`), the input surface (`--bg-input`), the validator / picker band (`--bg-deep`), and a derived hover shade (`--bg-card-hover`). The more specific `cardSecondary` and `input` tokens override individual tiers on top of this. |
| `cardSecondary`    | hex string                    | Secondary surface tier: the validator / picker band (`--bg-deep`) and the secondary panel (`--bg-secondary`). Overrides the `card` bundle for those two surfaces only; leaves `--bg-card` and `--bg-input` untouched. |
| `input`            | hex string                    | Input surface (text / amount inputs, `--bg-input`). Overrides the `card` bundle for the input surface only. |
| `mutedForeground`  | hex string                    | Muted/secondary text: labels, captions, helper text.                     |
| `border`           | hex string                    | Border color of inputs, cards, and dividers.                             |
| `borderFocus`      | hex string                    | Focused/secondary border (focused inputs, emphasized dividers).          |
| `warning`          | hex string                    | Warning notification color.                                              |
| `success`          | hex string                    | Success notification color.                                              |
| `error`            | hex string                    | Error notification color.                                                |
| `radius`           | number                        | Corner radius in px, 0-64 inclusive.                                     |
| `fontSize`         | number                        | Base font size in px, 8-32 inclusive. Applied at the iframe document root, so it scales the entire widget (every surface is authored in `rem`), not just one text element. |
| `fontFamily`       | string                        | CSS font-family; CSS-safe subset, no `<>;{}=()`, no newlines, max 200ch. |

Every field is optional and every color value must be a hex string (`#RGB` or `#RRGGBB`); other CSS color notations (rgb(), named colors) are rejected so the wire surface stays trivial to validate and free of CSS-injection footguns.

**Presets and overrides.** Pick a preset with `mode` (`'dark'` default or `'light'`), then override individual tokens on top of it. Omitting `mode` and every token gives the dark preset unchanged. The override model is additive: `{ mode: 'light', accentColor: '#7b61ff' }` renders the full light preset with only the accent swapped.

**Surface tiers (`card` / `cardSecondary` / `input`).** `card` is the convenience bundle: it sets the card / panel (`--bg-card`), the secondary panel (`--bg-secondary`), the input surface (`--bg-input`), the validator / picker band (`--bg-deep`), and a derived hover shade (`--bg-card-hover`) in one shot. The two more specific tokens are applied after the bundle and win for their tier: `cardSecondary` overrides the secondary / band surfaces (`--bg-secondary` + `--bg-deep`), and `input` overrides the input surface (`--bg-input`). Use `card` alone for a single flat surface color, then reach for `cardSecondary` / `input` only when you want those tiers to differ. Each is independent: supplying `cardSecondary` or `input` without `card` overrides just that tier and leaves the rest at the dapp default.

If any single field fails validation the entire theme is dropped and the widget renders with its defaults; the SDK emits one `console.warn` describing the failure. The widget does not download fonts, so use a `fontFamily` already loaded on the host page.

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

- `width`: any CSS width applied to the iframe. When omitted, the SDK does not set the `width` option at all; the iframe falls back to its built-in `width: 100%` (the iframe element is always created with `width: 100%`). Pass `width` only to override that.
- `maxWidth`: any CSS max-width applied to the iframe. Default unset (no cap). The form inside the widget fills the iframe, so capping the iframe width with `maxWidth` also caps the form - the form never stretches past `maxWidth` even on a wider viewport.
- `padding`: applied to the wrapper, not the iframe. Default `'0'`.
- `minHeight`: starting iframe height before the widget reports its content size. Default `'480px'`.

The runtime iframe height is managed by the SDK's resize handler and cannot be overridden.

#### `className` / `style` target differently across the two surfaces

These two props attach to a different element depending on which surface you use, so apply them with the right target in mind:

- Vanilla `mount()`: `className` and `style` are applied to the iframe element.
- React `<AtomCircuitSwap />`: `className` and `style` are applied to the outer container `<div>` the component renders, not the iframe. (The `[data-atom-circuit-embed]` marker lives on the SDK-managed wrapper nested inside that container, so `[data-atom-circuit-embed] iframe` still resolves to exactly one iframe.)

In both cases `height` and `width` are managed by the SDK (use the `width` / `maxWidth` / `minHeight` options for sizing) and any `height` / `width` in `style` is ignored.

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

The iframe advertises a set of capability strings during the handshake. These are purely informational; they let a host inspect what the iframe supports for diagnostics or logging. They are not a host-callable API: the host surface is `on` / `destroy` / `getHandshake` / `has`, and the widget drives its own swap flow internally. There is no programmatic-submit method on the client.

```ts
const result = AtomCircuit.mount(container, {
  referralId: 'YOUR_REFERRAL_ID',
  onReady: () => {
    // Informational only - e.g. log which capabilities the iframe advertised.
    if (result.client.has('swap.status')) {
      console.log('widget advertises swap.status events');
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

The widget stays mounted across navigations; only `display` toggles. Both wallet and form state are preserved. Trade-off: the iframe and dapp instance stay in memory on every page.

### Pattern 2 - imperative mount once

Use `AtomCircuit.mount()` directly into a persistent DOM container outside the router-managed area. Show or hide via CSS:

```html
<div id="atom-circuit-widget" style="display: none;"></div>
<script src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"></script>
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

Current SRI hash:

```html
<script
  src="https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js"
  integrity="sha384-rZ29F2zRBfHEVxJldYGp/+NjMEXyVfDbGB9ifxpw0kub3yQoAWxYKeYbn7t42mBe"
  crossorigin="anonymous"
></script>
```

Verify the hash yourself:

```sh
curl -sL https://unpkg.com/@atom-circuit/embed-sdk@2.1.0/dist/atom-circuit.iife.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Each release publishes a fresh hash on the [GitHub release page](https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases); bump the version pin and the `integrity` value together. See [SECURITY.md](./SECURITY.md) for the disclosure channel and the full trust boundary.

### Sandbox attributes

```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
```

`allow-same-origin` is required so Keplr can inject `window.keplr`. `allow-popups` and its escape variant let wallet popups (Keplr, Cosmostation) open. `allow-top-navigation` is intentionally omitted to limit clickjacking surface.

### Chrome storage partitioning (115+)

Chromium 115+ partitions iframe storage by `(iframe origin, top-level site)`. A user who connected their wallet on `validatorA.com` will need to reconnect on `validatorB.com`; each host gets its own isolated wallet session inside the widget.

## Versioning

- The npm package follows semver. Major bumps signal a breaking change to `mount()` or `<AtomCircuitSwap />`.
- The iframe wire protocol version (`PROTOCOL_VERSION`) is independent of the npm package version. SDK and iframe negotiate at handshake time; a major mismatch surfaces as `onError` with `code: 'protocol_incompatible'` (the widget does not mount in a broken state). A minor or patch difference within the same major is wire-compatible: the SDK logs a single `console.warn` and the widget still mounts.

## Compatibility

- React: `>=17 <20` (peer dependency, optional).
- Modern evergreen browsers, ES2020 baseline. Tested: Chromium 115+, Firefox 115+, Safari 16+.
- Desktop browser extensions (Keplr, Cosmostation) are the primary wallet path. Mobile WalletConnect inside an iframe has documented iOS Safari issues.
- Node.js `>=20` for development of this package.
- No GPL or other non-permissive runtime dependencies.

## Cosmiframe coexistence

The Atom Circuit dapp loads [Cosmiframe](https://github.com/DA0-DA0/cosmiframe) for an unrelated integration. When the embedded widget runs on a host page, Cosmiframe logs `Failed to detect Cosmiframe parent of allowed origin` to the browser console. This is non-blocking noise from the dapp side; the swap widget itself functions normally and your `onReady` / `onSwap*` callbacks fire as expected.

## License

MIT. See [LICENSE](./LICENSE).
