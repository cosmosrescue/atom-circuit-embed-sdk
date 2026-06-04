# Changelog

All notable changes to this project are documented in this file. The format
follows Keep a Changelog (https://keepachangelog.com/en/1.1.0/), and this
project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-06-04

### Added

- `onSwapBridging` host event (`mount()` option and `<AtomCircuitSwap />` prop): fires while a multi-step swap's bridge leg is still settling (e.g. a CCTP transfer mid-attestation). The source transaction has broadcast and funds are bridging to the next chain; the swap is not yet complete. Non-terminal - a later `onSwapSuccess` / `onSwapError` still fires for the same swap. Payload `{ chainId, explorerLink? }`. Backward compatible: integrators who do not subscribe are unaffected.

## [2.1.0] - 2026-06-04

### Added

- **Parent-page wallet reuse.** New `wallet` option on `mount()` and `<AtomCircuitSwap />`. When `wallet.mode` is `'parent'`, the embedded widget reuses the wallet already connected on your page instead of asking the user to connect again inside the iframe. The end user keeps signing in their own wallet UI; keys never leave their wallet.
  - Two modes via `wallet.mode`: `'iframe'` (the default - the widget connects its own wallet, exactly as before) and `'parent'` (the widget reuses your page's connected wallet over a postMessage bridge).
  - Cosmos reuse is wired by passing `wallet.cosmos` (a `target` wallet client plus `getOfflineSignerDirect` / `getOfflineSignerAmino`). The Cosmos bridge delegates to [@dao-dao/cosmiframe](https://github.com/DA0-DA0/cosmiframe), which enforces origin + source checks natively on both sides.
  - EVM reuse is wired by passing `wallet.evm` (an EIP-1193 `provider`). The EVM bridge is a custom postMessage relay (`atomcircuit:evm` envelope) that validates `event.origin` and `event.source` on every inbound message and targets the widget origin explicitly on every outbound message, never `'*'`. It relays `provider.request(...)` and forwards `accountsChanged` / `chainChanged` / `disconnect`; `on` / `removeListener` are optional.
  - Parent mode trusts the page it is embedded in by its own origin: the SDK stamps its actual embedding origin (`window.location.origin`) into the iframe URL as `parentOrigin`, and the widget trusts that single origin for the bridge. The browser supplies that origin and a page cannot spoof it, so the bridge works with nothing to register and the per-message origin and source checks enforce it.
  - You may supply `cosmos`, `evm`, or both; the loader wires only the side(s) present.
- **Connect-after-mount (`setWallet` / `clearWallet`).** `mount()` now returns `setWallet(handles)` and `clearWallet(channels?)`. The recommended flow ("render now, adopt later"): mount the widget immediately in `'parent'` mode with no handles (the widget is visible the whole time), then call `setWallet` the moment your user connects on your page - the iframe auto-adopts the reused wallet with no remount and no reconnect. `clearWallet` reverts the channel(s) to the in-iframe connect fallback when your user disconnects. Both are no-ops unless mounted in `'parent'` mode. In React this is automatic: pass the `wallet.cosmos` / `wallet.evm` handle on a later render and the component diffs handle identity and drives `setWallet` / `clearWallet` for you (changing `wallet.mode` still remounts; changing only the handles does not).
- **In-widget connect UX (`onWalletConnectRequest` + `connectPrompt`).** In `'parent'` mode, supply `onWalletConnectRequest(channel)` and the widget shows an actionable Connect button: on click it invokes your handler with the channel (`'cosmos'` / `'evm'`) so you run your own connect flow, then call `setWallet` (or pass the handle in React) to adopt. One handler can service both channels. Omit the handler and the widget shows a passive text prompt instead; `connectPrompt` overrides that prompt text (otherwise a friendly generic default is used). When no parent wallet is available the widget always gracefully falls back to its own in-iframe connect.
- **Wallet adapter helpers** (exported from the package root, dependency-free; the explicit handle objects remain the underlying contract):
  - `fromCosmosKit(client, metadata?)` - adapts a connected cosmos-kit wallet client (Keplr, Leap, Cosmostation, etc.) into a `wallet.cosmos` handle.
  - `fromInjectedCosmosWallet(provider, options?)` - adapts a raw Keplr-API-compatible injected provider (`window.keplr`, Cosmostation, and any other Keplr-compatible injected wallet) into a `wallet.cosmos` handle.
  - `fromKeplr` - backward-compatible alias of `fromInjectedCosmosWallet` (it accepts any Keplr-compatible provider, not only Keplr). Prefer `fromInjectedCosmosWallet`; the alias will be removed in a future major.
  - `fromWagmi(provider)` - adapts an already-resolved EIP-1193 / wagmi provider into the `wallet.evm` handle.
- **Expanded theming.** New `ThemeOptions` tokens beyond the original four colors: `card` (card / panel / input surface, with a derived hover shade), `mutedForeground` (labels, captions, helper text), `accentForeground` (text/icon on top of the accent, e.g. primary-button label), `borderFocus` (focused/secondary border), and the notification colors `warning`, `success`, `error`. Two built-in presets selected via `theme.mode` (`'dark'` default, `'light'`; `'auto'` follows the host system preference); the override model is additive: pick a preset, then override individual tokens on top of it. All color values are hex (`#RGB` / `#RRGGBB`) and any single invalid field drops the entire theme (the widget falls back to defaults and logs one `console.warn`).
  - Two further surface-tier tokens: `cardSecondary` and `input`. `card` stays the convenience bundle (it sets `--bg-card`, `--bg-secondary`, `--bg-input`, `--bg-deep`, and a derived `--bg-card-hover` in one shot). `cardSecondary` overrides the secondary / band tier only (`--bg-secondary` + `--bg-deep`); `input` overrides the input surface only (`--bg-input`). The specific tokens are applied after the `card` bundle so they win for their tier, and each works standalone without `card`.
- New public types: `WalletOptions`, `WalletCosmosHandle`, `WalletEvmHandle`, `WalletChannel`, `WalletReadyMessage`, `WalletGoneMessage`, `WalletHelloMessage`, `WalletConnectRequestMessage`, `WalletCapabilitiesMessage`, `WalletSignalMessage`, `Eip1193ProviderLike`, `OfflineSignerLike`, `CSSPropertiesLike`, `CosmosKitClientLike`, `KeplrInjectedProviderLike`, `KeplrKeyLike`, `DerivedCosmosAccount`, `DerivedCosmosSimpleAccount`, `FromInjectedCosmosWalletOptions`, `FromKeplrOptions`. New constants `WALLET_SIGNAL_NS`, `EVM_BRIDGE_NS` (also exposed on the IIFE `window.AtomCircuit` global, matching the npm exports).

### Changed

- New runtime dependency `@dao-dao/cosmiframe` (`^1.0.0`), used by the parent-side Cosmos bridge.

### Security

- Documented the parent-page wallet bridge trust model in `SECURITY.md`: keys never leave the user's wallet, the user's own wallet confirmation is the authoritative backstop, origin trust via the unspoofable embedding origin stamped as `parentOrigin`, per-message origin + source validation on both channels, and fail-closed graceful fallback.
- Noted in `SECURITY.md` that cosmiframe's native `cosmiframe_keystorechange` `window` listener is not origin-validated (library behaviour, not SDK config). Impact is low: the signal carries no payload and only prompts the iframe to re-read the active account through the origin-validated cosmiframe channel; it cannot inject, swap, or forge an account, and cannot forge a signature.

### Compatibility

- Fully backward compatible. Omitting the `wallet` option, or setting `wallet.mode` to `'iframe'` (the default), produces a byte-identical iframe URL and zero bridge wiring - behaviour is identical to 1.x. The major version bump reflects the new dependency and the expanded public surface, not a behaviour change for existing embeds.
- Graceful fallback: in `'parent'` mode, if the bridge cannot be established for any reason (origin mismatch, no parent wallet, unsupported wallet, handshake timeout), the widget silently falls back to in-iframe connect. The user can always swap.

## [1.3.0] - 2026-06-02

### Added

- `allowReferralChoice` option on `mount()` and `<AtomCircuitSwap />`. When `true`, the embed renders a picker of all participating validators with `referralId` as the pre-selected default, letting the end user choose which validator the affiliate fee is staked to; the choice persists across reloads. Default `false` leaves the existing fixed-`referralId` behaviour unchanged (the flag is omitted from the config payload when off).

## [1.2.2] - 2026-06-02

- Minor change.

## [1.2.1] - 2026-05-29

- Initial public release.
