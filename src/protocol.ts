/**
 * Atom Circuit Embed SDK - wire protocol contracts.
 *
 * Every message passed between host page and iframe must match one of the
 * discriminated unions exported here. Strict origin and shape checks rely on
 * these types both at compile time and at runtime (see assertion helpers).
 */

/**
 * Wire-protocol major. SDK sends this in the URL (`?v=`) and during the
 * handshake. The iframe must honor at least the last 2 majors or 18 months
 * of SDK versions, whichever is longer. Bumped on every
 * breaking wire change; independent of the npm package version.
 */
export const PROTOCOL_VERSION = '1.0.0';

/**
 * Origin the SDK trusts for all postMessage traffic. Equality, not prefix.
 */
export const WIDGET_ORIGIN = 'https://atomcircuit.net';

/**
 * Path of the embedded swap page on the widget origin.
 */
export const WIDGET_PATH = '/embed/swap';

/**
 * Capabilities advertised in the handshake. Names are stable strings; new
 * capabilities may be added without breaking older SDKs (they simply ignore
 * unknown entries).
 */
export type Capability =
  | 'swap.submit'
  | 'swap.status'
  | 'resize.report'
  | 'events.stream';

export type Capabilities = ReadonlyArray<Capability | string>;

/**
 * Handshake payload exchanged once on connect. The iframe is expected to
 * reply with its own handshake describing its protocol version + capability
 * set; the SDK warns (does not throw) when the major versions diverge.
 */
export interface HandshakeMessage {
  readonly type: 'handshake';
  readonly protocolVersion: string;
  readonly capabilities: Capabilities;
}

/**
 * Iframe -> host: notify a new content height. Host clamps to `minHeight`
 * before applying. Sent on every measured change, RAF-debounced inside the
 * iframe.
 */
export interface ResizeMessage {
  readonly type: 'atomcircuit:resize';
  readonly height: number;
}

/**
 * Names of public events the iframe may emit. Stable additions go to the
 * end of the union to preserve exhaustive-match safety in older SDKs.
 */
export type WidgetEventName =
  | 'ready'
  | 'swap:submitted'
  | 'swap:bridging'
  | 'swap:success'
  | 'swap:error';

/**
 * Generic event envelope. The `payload` shape is event-specific and typed
 * via the discriminated `WidgetEvent` union below.
 */
export interface WidgetEventMessage {
  readonly type: 'atomcircuit:event';
  readonly name: WidgetEventName;
  readonly payload?: unknown;
}

/* ------------------------------------------------------------------------- */
/* Typed event payloads                                                       */
/* ------------------------------------------------------------------------- */

export interface ReadyPayload {
  readonly protocolVersion: string;
}

export interface SwapSubmittedPayload {
  readonly txHash: string;
  readonly route?: SwapRouteSummary;
}

export interface SwapBridgingPayload {
  /**
   * The intermediate chain id the funds are currently bridging on / through.
   * The source-chain tx already succeeded (see {@link SwapSubmittedPayload});
   * this event marks the swap as still in flight, NOT terminal.
   */
  readonly chainId: string;
  /**
   * Optional Skip explorer deep-link for tracking the in-flight bridge leg.
   */
  readonly explorerLink?: string;
}

export interface SwapSuccessPayload {
  readonly txHash: string;
}

export interface SwapErrorPayload {
  readonly code: string;
  readonly message: string;
}

export interface SwapRouteSummary {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly sourceDenom: string;
  readonly destDenom: string;
  readonly amountIn: string;
  readonly amountOut?: string;
}

/**
 * Discriminated union of all valid widget events. Use this when typing event
 * subscribers on the host side.
 */
export type WidgetEvent =
  | { readonly name: 'ready'; readonly payload: ReadyPayload }
  | { readonly name: 'swap:submitted'; readonly payload: SwapSubmittedPayload }
  | { readonly name: 'swap:bridging'; readonly payload: SwapBridgingPayload }
  | { readonly name: 'swap:success'; readonly payload: SwapSuccessPayload }
  | { readonly name: 'swap:error'; readonly payload: SwapErrorPayload };

/**
 * Every accepted message on the wire.
 */
export type ProtocolMessage =
  | HandshakeMessage
  | ResizeMessage
  | WidgetEventMessage;

/* ------------------------------------------------------------------------- */
/* Theme + sizing                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Optional theming contract passed from host to iframe via the `?theme=` URL
 * parameter (base64-encoded compact JSON of this object).
 *
 * Contract:
 * - The SDK validates every field against the rules documented per-field. If
 *   ANY field fails validation, the entire theme is dropped and the iframe
 *   falls back to its default appearance. Validation is intentionally strict
 *   so a malformed theme cannot break the embed or be used as an injection
 *   vector against the iframe's CSS surface.
 * - Fields are optional; the iframe must accept partial themes and apply only
 *   the keys present.
 * - Color values are CSS hex strings (`#RGB` or `#RRGGBB`). Other CSS color
 *   notations (rgb(), named colors) are rejected to keep the wire surface
 *   trivial to validate and to avoid CSS-injection footguns via string
 *   interpolation on the iframe side.
 * - `radius` and `fontSize` are plain pixel numbers in tight bounds.
 * - `fontFamily` is a CSS-safe subset: letters, digits, spaces, hyphens,
 *   commas, single/double quotes, dots. Anything containing `<`, `>`, `;`,
 *   `{`, `}`, `=`, `(`, `)`, newlines, or tabs is rejected. Max 200 chars.
 * - The iframe applies these as CSS custom properties on its embed root;
 *   see the dapp side for the variable mapping.
 *
 * Omitting the `theme` field on MountOptions omits the `?theme=` param
 * from the iframe URL entirely.
 */
export interface ThemeOptions {
  /** Light/dark/auto mode hint. Auto follows the host system preference. */
  readonly mode?: 'light' | 'dark' | 'auto';
  /** Brand accent color used for primary buttons and highlights. Hex only. */
  readonly accentColor?: string;
  /** Page background color. Hex only. */
  readonly background?: string;
  /** Primary text/foreground color. Hex only. */
  readonly foreground?: string;
  /** Border color for inputs, cards, dividers. Hex only. */
  readonly border?: string;
  /**
   * Card / panel / input surface color (one step up from `background`). Maps to
   * the dapp's --bg-card / --bg-secondary / --bg-input / --bg-deep plus a
   * derived --bg-card-hover. Hex only. Absent => dapp defaults unchanged. The
   * more specific `cardSecondary` and `input` tokens, when present, override
   * the secondary/band and input tiers respectively (applied after this bundle
   * so they win).
   */
  readonly card?: string;
  /**
   * Secondary surface tier color: the validator / picker band (--bg-deep) and
   * the secondary panel (--bg-secondary). Overrides the `card` bundle's value
   * for those two surfaces. Hex only. Absent => the `card` bundle (or the dapp
   * default) keeps the band/secondary color unchanged.
   */
  readonly cardSecondary?: string;
  /**
   * Input surface color (text/amount inputs). Maps to the dapp's --bg-input,
   * overriding the `card` bundle's input value. Hex only. Absent => the `card`
   * bundle (or the dapp default) keeps the input color unchanged.
   */
  readonly input?: string;
  /**
   * Muted/secondary text color (labels, captions, helper text). Maps to the
   * dapp's --text-secondary and --text-tertiary. Hex only.
   */
  readonly mutedForeground?: string;
  /**
   * Text/icon color rendered ON TOP of the accent color (e.g. primary-button
   * label). Maps to the dapp's --accent-foreground. Hex only.
   */
  readonly accentForeground?: string;
  /**
   * Focused/secondary border color (focused inputs, emphasized dividers). Maps
   * to the dapp's --border-secondary. Hex only.
   */
  readonly borderFocus?: string;
  /** Warning notification color. Maps to the dapp's --warning. Hex only. */
  readonly warning?: string;
  /** Success notification color. Maps to the dapp's --success. Hex only. */
  readonly success?: string;
  /** Error notification color. Maps to the dapp's --error. Hex only. */
  readonly error?: string;
  /** Corner radius in pixels. Range: 0-64 inclusive. */
  readonly radius?: number;
  /** Base font size in pixels. Range: 8-32 inclusive. */
  readonly fontSize?: number;
  /** CSS font-family value. CSS-safe subset only; see ThemeOptions doc. */
  readonly fontFamily?: string;
}

/* ------------------------------------------------------------------------- */
/* Chrome options                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Toggles for the visual chrome surfaces rendered by the embed page. Each
 * surface defaults to ON (true) so an embed dropped in with no chrome
 * option shows the full chrome. Setting a flag to false hides the
 * corresponding surface.
 *
 * Encoded into the iframe URL as part of the `?theme=` base64-JSON
 * payload under the `chrome` key. Validation is strict: each present field
 * must be a boolean, otherwise the entire chrome bundle is rejected.
 *
 * Omitting the `chrome` field, or omitting individual flags, leaves the
 * default-on behaviour in place.
 */
export interface ChromeOptions {
  /** Show the Atom Circuit logo in the top bar. Default true. */
  readonly logo?: boolean;
  /** Show the wallet connect / disconnect button in the top bar. Default true. */
  readonly wallet?: boolean;
  /** Show the "Fees stake with <moniker>" validator badge. Default true. */
  readonly validator?: boolean;
  /** Show the "Powered by Atom Circuit" footer. Default true. */
  readonly footer?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Parent-page wallet reuse (opt-in)                                          */
/* ------------------------------------------------------------------------- */

/**
 * Minimal EIP-1193 provider surface the EVM bridge relies on. The integrator's
 * connected wallet (wagmi connector client, window.ethereum, etc.) satisfies
 * this. `on` / `removeListener` are optional: when absent the bridge simply
 * relays `request(...)` calls and forwards no push events.
 */
export interface Eip1193ProviderLike {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * An offline signer object as returned by a connected Cosmos wallet. Kept
 * structurally loose (the cosmiframe parent listener proxies whatever the
 * integrator's wallet returns) so the SDK does not pull a hard dependency on
 * @cosmjs typings into the public surface.
 */
export type OfflineSignerLike = Record<string, unknown>;

/**
 * The Cosmos half of {@link WalletOptions.cosmos}. Mirrors the cosmiframe
 * `ListenOptions` subset the bridge passes through verbatim.
 */
export interface WalletCosmosHandle {
  /**
   * The integrator's connected wallet client object. Non-signer methods
   * (getKey, enable, etc.) are proxied generically to this object by the
   * cosmiframe parent listener.
   */
  readonly target: Record<string, unknown>;
  /**
   * Returns the direct (protobuf) offline signer for a chain id, from the
   * integrator's connected wallet.
   */
  readonly getOfflineSignerDirect: (
    chainId: string
  ) => OfflineSignerLike | Promise<OfflineSignerLike>;
  /**
   * Returns the amino offline signer for a chain id, from the integrator's
   * connected wallet.
   */
  readonly getOfflineSignerAmino: (
    chainId: string
  ) => OfflineSignerLike | Promise<OfflineSignerLike>;
  /**
   * Optional parent metadata (name + image) the iframe may display to tell the
   * user which wallet they are signing with.
   */
  readonly metadata?: { readonly name?: string; readonly imageUrl?: string };
}

/**
 * The EVM half of {@link WalletOptions.evm}. The bridge relays EIP-1193
 * `request(...)` calls to this provider and forwards its push events.
 */
export interface WalletEvmHandle {
  readonly provider: Eip1193ProviderLike;
}

/**
 * Parent-page wallet reuse options. Opt-in and fully additive. `mode` is a
 * required field: omit the entire `wallet` option to get the default in-iframe
 * connect (byte-identical iframe URL and zero bridge wiring). Supplying `wallet`
 * with `mode: 'iframe'` is equivalent to omitting it; set `mode: 'parent'` to
 * reuse the parent page's already-connected wallet over the postMessage bridge.
 *
 * When `mode` is `'parent'`:
 * - The embed trusts the page it is in by that page's own origin: the SDK
 *   stamps its actual parent origin into the iframe URL and the dapp trusts that
 *   single origin directly. The runtime bridge enforces per-message origin /
 *   source checks on top of that.
 * - At least one of `cosmos` / `evm` should be supplied; the loader wires up
 *   only the side(s) present.
 *
 * See the SDK 2.0 wallet-reuse spec, sections 2-7.
 */
export interface WalletOptions {
  /**
   * Required explicit choice between in-iframe connect (`'iframe'`) and
   * parent-page wallet reuse (`'parent'`). There is no default value for this
   * field; to get the default in-iframe connect behaviour omit the entire
   * `wallet` option rather than passing a value here.
   */
  readonly mode: 'iframe' | 'parent';
  /** Cosmos wallet handle. When present, the Cosmos bridge is wired. */
  readonly cosmos?: WalletCosmosHandle;
  /** EVM wallet handle. When present, the EVM bridge is wired. */
  readonly evm?: WalletEvmHandle;
}

/* ------------------------------------------------------------------------- */
/* EVM bridge wire envelopes (Appendix A.3)                                   */
/* ------------------------------------------------------------------------- */

/**
 * Namespace tag carried by every EVM bridge message. Distinct from the event
 * bridge's `handshake` / `atomcircuit:resize` / `atomcircuit:event` types so
 * the two listeners never cross-trigger.
 */
export const EVM_BRIDGE_NS = 'atomcircuit:evm';

/**
 * Request envelope (iframe -> parent). `id` is a fresh unique string per
 * request; the parent echoes it on the matching response.
 */
export interface EvmRequestMessage {
  readonly ns: typeof EVM_BRIDGE_NS;
  readonly kind: 'request';
  readonly id: string;
  readonly method: string;
  readonly params?: unknown[];
}

/**
 * Success response envelope (parent -> iframe).
 */
export interface EvmResponseSuccess {
  readonly ns: typeof EVM_BRIDGE_NS;
  readonly kind: 'response';
  readonly id: string;
  readonly result: unknown;
}

/**
 * Error response envelope (parent -> iframe). `error.code` mirrors the
 * provider's numeric JSON-RPC / EIP-1193 error code where available.
 */
export interface EvmResponseError {
  readonly ns: typeof EVM_BRIDGE_NS;
  readonly kind: 'response';
  readonly id: string;
  readonly error: { readonly code: number; readonly message: string };
}

export type EvmResponseMessage = EvmResponseSuccess | EvmResponseError;

/**
 * Provider push event envelopes (parent -> iframe). One per EIP-1193 event the
 * bridge forwards.
 */
export type EvmEventMessage =
  | {
      readonly ns: typeof EVM_BRIDGE_NS;
      readonly kind: 'event';
      readonly event: 'accountsChanged';
      readonly accounts: string[];
    }
  | {
      readonly ns: typeof EVM_BRIDGE_NS;
      readonly kind: 'event';
      readonly event: 'chainChanged';
      readonly chainId: string;
    }
  | {
      readonly ns: typeof EVM_BRIDGE_NS;
      readonly kind: 'event';
      readonly event: 'disconnect';
      /**
       * The EIP-1193 `disconnect` event delivers a `ProviderRpcError`. When the
       * provider supplies one it is forwarded here (normalized to `{ code,
       * message }`); absent when the provider fired `disconnect` with no error
       * argument. The iframe-side consumer may ignore it.
       */
      readonly error?: { readonly code: number; readonly message: string };
    };

/**
 * Any message on the EVM bridge channel.
 */
export type EvmBridgeMessage =
  | EvmRequestMessage
  | EvmResponseMessage
  | EvmEventMessage;

/* ------------------------------------------------------------------------- */
/* Wallet-ready signal envelopes (Appendix A.4)                               */
/* ------------------------------------------------------------------------- */

/**
 * Namespace tag carried by every wallet-ready/gone signal. Distinct from the
 * EVM bridge namespace ({@link EVM_BRIDGE_NS}) and from the event bridge's
 * `handshake` / `atomcircuit:resize` / `atomcircuit:event` types, so none of
 * the listeners ever cross-trigger.
 *
 * The parent posts a {@link WalletReadyMessage} when wallet handles become
 * available or change (at mount if provided, or via `setWallet` after the
 * integrator connects later), and a {@link WalletGoneMessage} on teardown. The
 * iframe auto-adopts / reverts off these signals (spec section 5.5, "option Y":
 * widget always visible, adopts the moment the parent wallet connects).
 */
export const WALLET_SIGNAL_NS = 'atomcircuit:wallet';

/**
 * The wallet channels a signal refers to. Cosmos is bridged via cosmiframe;
 * EVM via the {@link EVM_BRIDGE_NS} envelope relay.
 */
export type WalletChannel = 'cosmos' | 'evm';

/**
 * Iframe -> parent: posted once the iframe's wallet layer is initialized and
 * listening. The parent replies with {@link CapabilitiesMessage}. This avoids
 * the race where the parent advertises capabilities (or posts an initial
 * `ready`) before the iframe's control-channel listener is attached. See spec
 * Appendix A.4.
 */
export interface WalletHelloMessage {
  readonly ns: typeof WALLET_SIGNAL_NS;
  readonly kind: 'hello';
}

/**
 * Iframe -> parent: posted when the user clicks Connect in parent mode for a
 * channel that is not yet bridged. The parent invokes the integrator's
 * `onWalletConnectRequest(channel)` so the integrator runs THEIR own connect
 * flow for that channel; on success the integrator calls `setWallet`, which
 * posts a {@link WalletReadyMessage} and the iframe adopts. See spec Appendix
 * A.4 / A.5.
 */
export interface WalletConnectRequestMessage {
  readonly ns: typeof WALLET_SIGNAL_NS;
  readonly kind: 'connect-request';
  readonly channel: WalletChannel;
}

/**
 * Parent -> iframe: sent in reply to {@link WalletHelloMessage}. A channel in
 * `canRequestConnect` is `true` iff the integrator registered an
 * `onWalletConnectRequest` handler (the single per-channel handler can service
 * both channels). This tells the iframe whether to show an actionable Connect
 * button (true) or the passive prompt (false) for that channel. `connectPrompt`
 * carries the integrator's optional passive-prompt text override (which the
 * iframe cannot otherwise know - it lives in the parent's mount options). See
 * spec Appendix A.4.
 */
export interface WalletCapabilitiesMessage {
  readonly ns: typeof WALLET_SIGNAL_NS;
  readonly kind: 'capabilities';
  readonly canRequestConnect: {
    readonly cosmos: boolean;
    readonly evm: boolean;
  };
  readonly connectPrompt?: string;
}

/**
 * Parent -> iframe: the named channel(s) are now bridged and available. On
 * receipt the iframe AUTO-ADOPTS them with no picker (cosmos = programmatically
 * connect the cosmiframe wallet; evm = wagmi-connect the postMessage parent
 * connector). See spec Appendix A.4 / section 5.5.
 */
export interface WalletReadyMessage {
  readonly ns: typeof WALLET_SIGNAL_NS;
  readonly kind: 'ready';
  readonly channels: readonly WalletChannel[];
}

/**
 * Parent -> iframe: the named channel(s) are no longer bridged (the integrator
 * disconnected or called `clearWallet`). On receipt the iframe disconnects the
 * bridged wallet(s) and reverts to the in-iframe connect fallback.
 */
export interface WalletGoneMessage {
  readonly ns: typeof WALLET_SIGNAL_NS;
  readonly kind: 'gone';
  readonly channels: readonly WalletChannel[];
}

/**
 * Any message on the wallet-signal channel (control + ready/gone). Both
 * directions share the {@link WALLET_SIGNAL_NS} namespace; the `kind`
 * discriminates direction and intent.
 */
export type WalletSignalMessage =
  | WalletHelloMessage
  | WalletConnectRequestMessage
  | WalletCapabilitiesMessage
  | WalletReadyMessage
  | WalletGoneMessage;

/* ------------------------------------------------------------------------- */
/* Mount options                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Stable error codes surfaced via the `onError` callback. Consumers should
 * treat unknown codes as opaque diagnostics rather than control-flow
 * signals.
 */
export type MountErrorCode =
  | 'handshake_failed'
  | 'iframe_load_failed'
  | 'origin_mismatch'
  | 'protocol_incompatible'
  | 'unknown';

/**
 * Shape of the error passed to `onError`. `cause` carries the original error
 * (if any) for diagnostic logging; it is typed as `unknown` so consumers
 * narrow it explicitly before use.
 */
export interface MountError {
  readonly code: MountErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * A React-`CSSProperties`-compatible inline-style bag. Keys are CSS property
 * names (camelCase); values are CSS strings (and numbers, for parity with
 * React's `CSSProperties` so the same object literal type-checks against both
 * the vanilla `MountOptions.style` and the React `style` prop). The vanilla
 * `mount()` applies only string values; numeric values are ignored there. Kept
 * as a structural alias so the SDK does not pull a hard `react` dependency into
 * the vanilla surface while staying assignable from a React `CSSProperties`.
 */
export type CSSPropertiesLike = Record<string, string | number | undefined>;

/**
 * Options accepted by both `mount(...)` (vanilla) and `<AtomCircuitSwap />`
 * (React). Required fields are kept to the absolute minimum so the embed
 * stays a one-liner for the validator.
 */
export interface MountOptions {
  /**
   * Validator-supplied affiliate identifier. Forwarded to the widget via the
   * iframe URL so fees route correctly.
   */
  /**
   * Validator referralId. Optional. When omitted (or empty / whitespace),
   * the SDK defaults to the literal string `'general'`, which fans the
   * affiliate fee across all participating Atom Circuit validators at
   * sweep time. Hosts that want fees to stake to a specific validator
   * pass that validator's 8-character hex referralId (or a registered
   * vanity slug).
   */
  referralId?: string;
  /**
   * Override the widget origin. Default `https://atomcircuit.net`. Used by
   * the test suite and local development only.
   */
  origin?: string;
  /**
   * Override the widget path. Default `/embed/swap`.
   */
  path?: string;
  /**
   * Minimum height applied to the iframe before any resize messages arrive.
   * Default `480px`.
   */
  minHeight?: string;
  /**
   * Optional additional CSS class. In vanilla `mount()` this is applied to the
   * IFRAME element. (The React `<AtomCircuitSwap />` `className` prop applies to
   * the WRAPPER div instead.)
   */
  className?: string;
  /**
   * Optional inline style merge. In vanilla `mount()` these styles are applied
   * to the IFRAME element. (The React `<AtomCircuitSwap />` `style` prop applies
   * to the WRAPPER div instead.) `height` and `width` are managed by the SDK
   * and ignored if supplied here.
   */
  style?: CSSPropertiesLike;
  /**
   * Fires once the iframe has loaded and the handshake completes.
   */
  onReady?: (payload: ReadyPayload) => void;
  /**
   * Fires on every measured content-height change.
   */
  onResize?: (info: { height: number }) => void;
  /**
   * Fires when the user submits a swap (tx broadcast).
   */
  onSwapSubmitted?: (payload: SwapSubmittedPayload) => void;
  /**
   * Fires while a submitted swap's funds are bridging on an intermediate chain
   * (source tx succeeded, swap not yet complete). NON-terminal: a later
   * `onSwapSuccess` or `onSwapError` still fires for the same swap. May fire
   * zero times for single-chain swaps that never bridge.
   */
  onSwapBridging?: (payload: SwapBridgingPayload) => void;
  /**
   * Fires when a submitted swap confirms on chain.
   */
  onSwapSuccess?: (payload: SwapSuccessPayload) => void;
  /**
   * Fires when a swap fails or is rejected by the wallet.
   */
  onSwapError?: (payload: SwapErrorPayload) => void;
  /**
   * Fires on SDK-level failures (iframe load failure, handshake timeout,
   * origin mismatch, etc). When not supplied the SDK emits a single warning
   * via the injected warn sink and returns. This is distinct from
   * `onSwapError`, which reports widget-level (in-iframe) swap failures.
   */
  onError?: (error: MountError) => void;
  /**
   * Optional theme. See {@link ThemeOptions} for the validated contract.
   * Validation failure silently drops the theme; the iframe falls back to
   * defaults.
   */
  readonly theme?: ThemeOptions;
  /**
   * Optional chrome toggles. See {@link ChromeOptions} for the validated
   * contract. Validation failure silently drops the chrome bundle; the
   * iframe falls back to all-chrome-on defaults. Encoded alongside `theme`
   * in the iframe URL.
   */
  readonly chrome?: ChromeOptions;
  /**
   * Whether the embed lets the end user choose which validator the swap
   * affiliate fee stakes to. Default `false`.
   *
   * - When `false` (default): `referralId` is the fixed affiliate for every
   *   swap in this embed. The end user cannot change it. This is the prior,
   *   unchanged behaviour - the embed shows the read-only validator badge
   *   (subject to the `chrome.validator` toggle) and `referralId` rides the
   *   `?ref=` URL param.
   * - When `true`: the embed renders an interactive validator picker with
   *   `referralId` pre-selected as the DEFAULT (or the `general` pool when
   *   `referralId` is unset). The end user may switch to any participating
   *   validator; their pick persists locally and seeds subsequent swaps. The
   *   picker shows regardless of the `chrome.validator` badge toggle.
   *
   * Encoded alongside `theme` + `chrome` inside the `?theme=` base64-JSON
   * payload under the top-level `allowReferralChoice` key. Only the literal
   * boolean `true` is carried on the wire; any other value (including the
   * default `false`) is omitted so a no-config embed is byte-identical to the
   * prior protocol output.
   */
  readonly allowReferralChoice?: boolean;
  /**
   * Whether the embed scales its whole UI up proportionally to fill the
   * available width. Default `false`.
   *
   * - When `false` (default): the embed renders at its natural density and
   *   reflows fluidly inside whatever width the host gives it (the prior,
   *   unchanged behaviour). No scaling is applied.
   * - When `true`: once the available width exceeds the widget's natural
   *   design width (480px), the embed scales its ENTIRE geometry up - text,
   *   buttons, icons, padding all grow together - so a wide container shows a
   *   larger, more legible widget instead of a small widget floating in empty
   *   space. The scale factor is `clamp(availableWidth / 480, 1.0, maxScale)`.
   *   Past `480 * maxScale` the scaled widget sits centered rather than
   *   stretching its proportions. Below 480px the embed falls back to the
   *   default fluid behaviour (no scaling), so it never overflows a narrow
   *   container or mobile viewport.
   *
   * Encoded alongside `theme` + `chrome` inside the `?theme=` base64-JSON
   * payload under the top-level `autoscale` key. Only the literal boolean
   * `true` is carried on the wire; any other value (including the default
   * `false`) is omitted so a no-config embed is byte-identical to the prior
   * protocol output. See {@link MountOptions.maxScale}.
   */
  readonly autoscale?: boolean;
  /**
   * The maximum scale factor applied when {@link MountOptions.autoscale} is
   * `true`. Default `1.5`. Clamped to the inclusive range `[1.0, 3.0]`; an
   * out-of-range or non-finite value falls back to the `1.5` default rather
   * than rejecting the rest of the payload.
   *
   * Only meaningful when `autoscale` is `true`; ignored otherwise. A value of
   * `1.0` pins the embed to its natural size even on very wide containers
   * (autoscale on, but no growth); `3.0` lets it grow up to triple size.
   *
   * Encoded alongside `autoscale` inside the same `?theme=` payload under the
   * top-level `maxScale` key, but ONLY when `autoscale` is `true` (the value
   * is meaningless without it). The default `1.5` is still written explicitly
   * when autoscale is on so the dapp side need not duplicate the default.
   */
  readonly maxScale?: number;
  /**
   * CSS `width` applied to the iframe. Default `'100%'` when omitted.
   */
  readonly width?: string;
  /**
   * CSS `max-width` applied to the iframe. Default unset (no cap) when
   * omitted.
   */
  readonly maxWidth?: string;
  /**
   * CSS `padding` applied to the wrapper element around the iframe (NOT to
   * the iframe element itself, since padding on iframes does not behave
   * intuitively across browsers). Default `'0'` when omitted.
   */
  readonly padding?: string;
  /**
   * Optional parent-page wallet reuse. See {@link WalletOptions}. Omit this
   * field entirely for the default in-iframe connect (byte-identical iframe URL
   * and zero bridge wiring); supplying it with `wallet.mode: 'iframe'` is
   * equivalent. Set `wallet.mode: 'parent'` to opt the embed into reusing the
   * integrator's already-connected wallet over the postMessage bridge. `mode`
   * is a required field of {@link WalletOptions} - there is no implicit default.
   */
  readonly wallet?: WalletOptions;
  /**
   * Parent-mode connect-prompt handler (spec Appendix A.4 / A.5). Invoked when
   * the iframe user clicks Connect in parent mode for a channel that is not yet
   * bridged. The integrator runs THEIR own connect flow for that channel and
   * calls `setWallet` on success (which posts the `ready` signal so the iframe
   * adopts the reused wallet). The single per-channel handler can service both
   * channels; if a channel is unserviceable the integrator's callback may
   * no-op.
   *
   * Presence drives the A.4 `capabilities` advert: when supplied, the iframe
   * shows an actionable Connect button for both channels; when absent, the
   * iframe shows the passive {@link MountOptions.connectPrompt} text and never
   * an in-iframe picker. Only meaningful when `wallet.mode === 'parent'`.
   */
  readonly onWalletConnectRequest?: (channel: WalletChannel) => void;
  /**
   * Override text for the passive not-connected prompt shown in the iframe when
   * no {@link MountOptions.onWalletConnectRequest} handler exists (spec Appendix
   * A.4 / A.5). Forwarded to the iframe in the `capabilities` reply. When
   * omitted the iframe falls back to its own friendly generic default. Only
   * meaningful when `wallet.mode === 'parent'`.
   */
  readonly connectPrompt?: string;
}

/* ------------------------------------------------------------------------- */
/* Runtime validators (strict, no `any`)                                      */
/* ------------------------------------------------------------------------- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isHandshakeMessage(value: unknown): value is HandshakeMessage {
  if (!isObject(value)) return false;
  if (value['type'] !== 'handshake') return false;
  if (!isString(value['protocolVersion'])) return false;
  if (!Array.isArray(value['capabilities'])) return false;
  return value['capabilities'].every(isString);
}

export function isResizeMessage(value: unknown): value is ResizeMessage {
  if (!isObject(value)) return false;
  if (value['type'] !== 'atomcircuit:resize') return false;
  return isFiniteNumber(value['height']) && value['height'] >= 0;
}

const WIDGET_EVENT_NAMES: ReadonlySet<WidgetEventName> = new Set([
  'ready',
  'swap:submitted',
  'swap:bridging',
  'swap:success',
  'swap:error',
]);

export function isWidgetEventMessage(
  value: unknown
): value is WidgetEventMessage {
  if (!isObject(value)) return false;
  if (value['type'] !== 'atomcircuit:event') return false;
  if (!isString(value['name'])) return false;
  return WIDGET_EVENT_NAMES.has(value['name'] as WidgetEventName);
}

/**
 * Runtime guard for an inbound EVM request envelope (the only EVM message the
 * parent ever RECEIVES). Strict: rejects anything not carrying the exact
 * namespace, kind, a string id, and a string method. `params`, when present,
 * must be an array. This guard is the wire-shape half of the bridge's defense;
 * the origin + source checks are the transport half (see wallet-bridge.ts).
 */
export function isEvmRequestMessage(value: unknown): value is EvmRequestMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== EVM_BRIDGE_NS) return false;
  if (value['kind'] !== 'request') return false;
  if (!isString(value['id'])) return false;
  if (!isString(value['method'])) return false;
  if (value['params'] !== undefined && !Array.isArray(value['params'])) {
    return false;
  }
  return true;
}

const WALLET_CHANNELS: ReadonlySet<WalletChannel> = new Set(['cosmos', 'evm']);

/**
 * Runtime guard for an inbound wallet-ready signal. Strict: the namespace must
 * match exactly, `kind` must be `'ready'`, and `channels` must be a non-empty
 * array of known channel names (`'cosmos'` / `'evm'`). The iframe uses this as
 * the wire-shape half of its defense; the origin + source checks are the
 * transport half. Distinct namespace from the EVM bridge so the two listeners
 * never cross-trigger.
 */
export function isWalletReadyMessage(value: unknown): value is WalletReadyMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== WALLET_SIGNAL_NS) return false;
  if (value['kind'] !== 'ready') return false;
  return isWalletChannelArray(value['channels']);
}

/**
 * Runtime guard for an inbound wallet-gone signal. Mirror of
 * {@link isWalletReadyMessage} with `kind === 'gone'`.
 */
export function isWalletGoneMessage(value: unknown): value is WalletGoneMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== WALLET_SIGNAL_NS) return false;
  if (value['kind'] !== 'gone') return false;
  return isWalletChannelArray(value['channels']);
}

/**
 * Runtime guard for an inbound `hello` (iframe -> parent). The parent uses this
 * as the wire-shape half of its defense; the origin + source checks are the
 * transport half (see wallet-bridge.ts).
 */
export function isWalletHelloMessage(value: unknown): value is WalletHelloMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== WALLET_SIGNAL_NS) return false;
  return value['kind'] === 'hello';
}

/**
 * Runtime guard for an inbound `connect-request` (iframe -> parent). Strict:
 * the namespace must match, `kind` must be `'connect-request'`, and `channel`
 * must be a single known channel name.
 */
export function isWalletConnectRequestMessage(
  value: unknown
): value is WalletConnectRequestMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== WALLET_SIGNAL_NS) return false;
  if (value['kind'] !== 'connect-request') return false;
  return isString(value['channel']) && WALLET_CHANNELS.has(value['channel'] as WalletChannel);
}

/**
 * Runtime guard for an inbound `capabilities` reply (parent -> iframe). The
 * iframe uses this as the wire-shape half of its defense. Strict:
 * `canRequestConnect` must carry boolean `cosmos` + `evm`, and `connectPrompt`,
 * when present, must be a string.
 */
export function isWalletCapabilitiesMessage(
  value: unknown
): value is WalletCapabilitiesMessage {
  if (!isObject(value)) return false;
  if (value['ns'] !== WALLET_SIGNAL_NS) return false;
  if (value['kind'] !== 'capabilities') return false;
  const can = value['canRequestConnect'];
  if (!isObject(can)) return false;
  if (typeof can['cosmos'] !== 'boolean') return false;
  if (typeof can['evm'] !== 'boolean') return false;
  if (value['connectPrompt'] !== undefined && !isString(value['connectPrompt'])) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for any wallet-signal message (hello / connect-request /
 * capabilities / ready / gone).
 */
export function isWalletSignalMessage(value: unknown): value is WalletSignalMessage {
  return (
    isWalletHelloMessage(value) ||
    isWalletConnectRequestMessage(value) ||
    isWalletCapabilitiesMessage(value) ||
    isWalletReadyMessage(value) ||
    isWalletGoneMessage(value)
  );
}

/** A non-empty array of known wallet channel names, no duplicates required. */
function isWalletChannelArray(value: unknown): value is readonly WalletChannel[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  return value.every(
    (entry): entry is WalletChannel =>
      isString(entry) && WALLET_CHANNELS.has(entry as WalletChannel)
  );
}

export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  return (
    isHandshakeMessage(value) ||
    isResizeMessage(value) ||
    isWidgetEventMessage(value)
  );
}

/**
 * Returns true when two protocol versions agree on their major number. Used
 * by the SDK to decide whether to warn the host on handshake.
 */
export function isCompatibleProtocol(sdkVersion: string, remoteVersion: string): boolean {
  const sdkMajor = sdkVersion.split('.')[0];
  const remoteMajor = remoteVersion.split('.')[0];
  return sdkMajor !== undefined && sdkMajor === remoteMajor;
}
