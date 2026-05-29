# Changelog

All notable changes to this project are documented in this file. The format
follows Keep a Changelog (https://keepachangelog.com/en/1.1.0/), and this
project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-29

- Docs: consolidate design notes into README.

## [1.1.1] - 2026-05-28

- Republish; no behavior change. IIFE bundle bytes byte-identical to 1.1.0.

## [1.1.0] - 2026-05-28

### Added

- `referralId` is now optional on both `mount()` and
  `<AtomCircuitSwap />`. When omitted, undefined, or an empty /
  whitespace-only string, the SDK defaults to `'general'` and the
  affiliate fee fans across all participating Atom Circuit
  validators at sweep time. Existing integrations that pass an
  explicit referralId continue to work without change.

## [1.0.1] - 2026-05-28

### Changed

- Dev-dependency refresh: vitest 4, typescript 6, jsdom 29, size-limit
  12, @types/node 25, and actions/checkout + actions/setup-node v6 in
  CI workflows. No runtime impact; the published IIFE bundle bytes
  are byte-identical to 1.0.0 and the SRI hash is unchanged.

## [1.0.0] - 2026-05-28

### Added

- Pre-handshake loading overlay: centered spinner rendered inside the
  wrapper while the iframe is fetching the dapp bundle. Fades out on the
  first `ready` event and on `onError` so a permanent handshake failure
  never leaves a forever-spinning state.
- `referralId: 'general'` documented as a first-class option for hosts
  that do not represent a single validator. The affiliate fee is split
  across all participating validators (registered Atom Circuit validators
  with at least one prior swap attribution).

### Changed

- The iframe is now ALWAYS wrapped in `<div data-atom-circuit-embed>`
  regardless of whether `padding` is supplied. The wrapper carries
  `position: relative` so the loading overlay can absolutely-position
  over the iframe. Hosts using the `container > iframe` direct-child
  selector should switch to `container iframe` or
  `[data-atom-circuit-embed] iframe`.
- `MountResult.wrapper` is no longer nullable. Existing code that
  checked `if (handle.wrapper)` continues to compile and behave
  correctly; the check is now always truthy.

## [0.1.0] - 2026-05-27

### Initial release

- Iframe-based swap widget embeddable on any website via vanilla JS or
  React, carrying a referralId so swap fees route to the host validator.
- Theming surface: optional `theme` object with `mode`, `accentColor`,
  `background`, `foreground`, `border`, `radius`, `fontSize`, `fontFamily`.
  Strict validation; invalid themes are silently dropped and the embed
  renders with defaults.
- Sizing surface: `width`, `maxWidth`, `padding` applied to the wrapper
  element around the iframe.
- Chrome toggles: `chrome.logo`, `chrome.wallet`, `chrome.validator`,
  `chrome.footer` flags to hide the corresponding embed surfaces.
- Stable `onError` callback for SDK-level failures (handshake timeout,
  iframe load failure, origin mismatch, protocol incompatibility) plus
  swap-level callbacks (`onSwapSubmitted`, `onSwapSuccess`, `onSwapError`).
- Penpal v7.x typed RPC layer plus a custom event stream for `ready`,
  `swap:submitted`, `swap:success`, `swap:error`, and `resize`.
- Hand-rolled ResizeObserver + MutationObserver auto-resize (MIT-licensed;
  no iframe-resizer dependency).
- Strict `https://atomcircuit.net` origin equality check on every inbound
  postMessage; sandboxed iframe with no `allow-top-navigation`.
- Cross-origin Playwright integration test covering ready,
  `swap:submitted`, `swap:success`, and destroy lifecycle across two
  127.0.0.1 ports.
- Vitest + jsdom unit suite covering protocol message validation,
  iframe-client raw-postMessage path, resize behaviour, theme validation,
  error reporting, capability gating, and React wrapper lifecycle.
- IIFE bundle at `dist/atom-circuit.iife.js` for `<script>`-tag drop-in on
  static sites.
- PostMessage protocol versioned independently of npm semver.

[1.2.0]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v1.2.0
[1.1.1]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v1.1.1
[1.1.0]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v1.1.0
[1.0.1]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v1.0.1
[1.0.0]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v1.0.0
[0.1.0]: https://github.com/cosmosrescue/atom-circuit-embed-sdk/releases/tag/v0.1.0
