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
   * Optional additional CSS class applied to the iframe element.
   */
  className?: string;
  /**
   * Optional inline style merge. `height` and `width` are managed by the SDK
   * and ignored if supplied.
   */
  style?: Partial<CSSStyleDeclaration>;
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
