/**
 * Vanilla mount factory. Builds the iframe element, applies sandbox attrs,
 * wires up the IframeClient + resize handler, and returns a destroy handle.
 */

import { IframeClient } from './iframe-client.js';
import { attachResize, type ResizeHandle } from './resize.js';
import {
  PROTOCOL_VERSION,
  WIDGET_ORIGIN,
  WIDGET_PATH,
  type CSSPropertiesLike,
  type MountError,
  type MountErrorCode,
  type MountOptions,
  type ReadyPayload,
  type SwapBridgingPayload,
  type SwapErrorPayload,
  type SwapSubmittedPayload,
  type SwapSuccessPayload,
  type WalletChannel,
  type WalletCosmosHandle,
  type WalletEvmHandle,
  type WalletOptions,
} from './protocol.js';
import {
  createWalletBridge,
  resolveWidgetOrigin,
  type WalletBridgeController,
} from './wallet-bridge.js';
import {
  encodeTheme,
  validateAllowReferralChoice,
  validateChrome,
  validateTheme,
} from './theme.js';

export type { MountOptions, MountError, MountErrorCode };
export type { WidgetEvent } from './protocol.js';
export { PROTOCOL_VERSION };

/**
 * Handshake timeout enforced by `mount()` via `Promise.race`. Mirrors the
 * default Penpal timeout in `IframeClient` so the error surface is
 * predictable even if a future refactor decouples the two.
 */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Sandbox attribute applied to the iframe. Allowed:
 *   - allow-scripts: widget needs JS.
 *   - allow-same-origin: required so Keplr can inject window.keplr.
 *   - allow-popups + allow-popups-to-escape-sandbox: wallet popups (Keplr,
 *     Cosmostation), tx success links.
 *   - allow-forms: in case future widget revs add a form-based on-ramp.
 *
 * Deliberately omitted: `allow-top-navigation` (clickjacking risk).
 */
export const SANDBOX_ATTR =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms';

/**
 * Inline SVG for the pre-handshake loading spinner. Rendered inside an
 * absolute-positioned overlay on the wrapper while the iframe is still
 * loading. The rotation is driven by the Web Animations API in mount()
 * rather than inline SMIL because SMIL set via `innerHTML` does not
 * reliably start the animation during the initial-page-load phase on
 * Chromium - the exact phase where the host needs the spinner to be
 * visibly spinning. The arc is painted with a brand gradient
 * (cyan -> violet) so the loader visually matches the dapp's accent
 * palette; the background ring is a neutral grey that reads on both
 * light and dark host backgrounds. The gradient id is namespaced to
 * avoid collisions with host page `<defs>`.
 */
const LOADER_SVG = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<circle cx="16" cy="16" r="13" stroke="#7B61FF" stroke-width="2.5" stroke-opacity="0.28"/>'
  + '<path d="M29 16a13 13 0 0 0-13-13" stroke="#33D6FF" stroke-width="2.5" stroke-linecap="round"/>'
  + '</svg>';

export interface MountResult {
  iframe: HTMLIFrameElement;
  /**
   * Wrapper div the iframe is appended to. Always present in v1.0.0 and
   * later. Hosts that previously relied on `container > iframe` should use
   * `container iframe` or `[data-atom-circuit-embed] iframe` instead. The
   * wrapper carries a position:relative anchor so the pre-handshake
   * loading overlay (the spinner) can absolutely-position over the iframe
   * without leaking into surrounding host layout. Padding (when supplied)
   * is applied to this wrapper, never to the iframe element itself.
   */
  wrapper: HTMLDivElement;
  client: IframeClient;
  /**
   * Supply or replace parent-page wallet handles AFTER mount (spec A.5). The
   * common flow: mount the widget immediately (always visible), then call
   * `setWallet` once the integrator's wallet connects. (Re)wires the parent
   * bridge for the provided channel(s) and posts the A.4 `ready` signal so the
   * iframe auto-adopts the reused wallet with no remount. Calling it again with
   * a fresh handle re-adopts cleanly (replace semantics per channel).
   *
   * No-op unless the embed was mounted with `wallet.mode === 'parent'` (the
   * URL must already carry `walletMode=parent` for the iframe to accept the
   * bridge). In mode `'iframe'` / absent there is no bridge to wire.
   */
  setWallet(handles: {
    cosmos?: WalletCosmosHandle;
    evm?: WalletEvmHandle;
  }): void;
  /**
   * Tear down the given parent-wallet channel(s) (or all when omitted) and post
   * the A.4 `gone` signal so the iframe reverts to the in-iframe connect
   * fallback. Used when the integrator's user disconnects on the parent page.
   * No-op when no bridge channel is wired.
   */
  clearWallet(channels?: readonly WalletChannel[]): void;
  destroy(): void;
}

type BuildSrcOpts = Pick<
  MountOptions,
  'origin' | 'path' | 'theme' | 'chrome' | 'allowReferralChoice' | 'wallet'
> & {
  /** Resolved referralId. mount() defaults undefined/empty to 'general'
   * before calling buildSrc, so this is always a non-empty string here. */
  readonly referralId: string;
  /** Optional warn sink used to report theme validation failures. */
  readonly warn?: (message: string) => void;
};

function buildSrc(opts: BuildSrcOpts): string {
  const origin = (opts.origin ?? WIDGET_ORIGIN).replace(/\/$/, '');
  const path = opts.path ?? WIDGET_PATH;
  const params = new URLSearchParams();
  params.set('ref', opts.referralId);
  params.set('v', PROTOCOL_VERSION);

  // Validate theme + chrome independently; the URL param is set when EITHER
  // half validates so a host can pass chrome alone without a theme override.
  const validatedTheme =
    opts.theme !== undefined ? validateTheme(opts.theme) : null;
  if (opts.theme !== undefined && validatedTheme === null && opts.warn) {
    opts.warn(
      'Atom Circuit embed: theme validation failed, falling back to defaults'
    );
  }
  const validatedChrome =
    opts.chrome !== undefined ? validateChrome(opts.chrome) : null;
  if (opts.chrome !== undefined && validatedChrome === null && opts.warn) {
    opts.warn(
      'Atom Circuit embed: chrome validation failed, falling back to defaults'
    );
  }

  // allowReferralChoice collapses to a strict boolean; only the literal `true`
  // is carried on the wire (default-false path stays byte-identical to prior
  // output). An invalid value is silently dropped (treated as false) rather
  // than rejecting the rest of the payload.
  const allowReferralChoice = validateAllowReferralChoice(
    opts.allowReferralChoice
  );

  // Set the `theme` param when ANY of theme / chrome / allowReferralChoice is
  // present so a host can opt into referral choice without supplying a theme
  // or chrome override.
  if (
    validatedTheme !== null ||
    validatedChrome !== null ||
    allowReferralChoice
  ) {
    params.set(
      'theme',
      encodeTheme(
        validatedTheme ?? {},
        validatedChrome ?? undefined,
        allowReferralChoice
      )
    );
  }

  // Parent-page wallet reuse signal (spec Appendix A.1). Present ONLY when the
  // host explicitly opts into mode 'parent'. Absent / 'iframe' => no params, so
  // the URL stays byte-identical to the pre-feature output (invariant #1).
  if (opts.wallet?.mode === 'parent') {
    params.set('walletMode', 'parent');
    // Parent mode trusts the embedding page by its own origin. The SDK runs in
    // the embedder's page, so the embedder's real origin is available here as
    // globalThis.location.origin. We stamp it as parentOrigin and the dapp
    // trusts it as the single allowed parent origin. This is safe because the
    // runtime bridge still checks event.origin / event.source on every message
    // against the widget origin; a forged parentOrigin simply produces a bridge
    // that no real parent can satisfy, so it fails closed.
    //
    // Only stamp a usable concrete origin. In a browser document the value is
    // always a real "https://host[:port]" string; the literal 'null' appears
    // for opaque/sandboxed origins and must never be trusted. Under SSR or any
    // environment without a location we set nothing (no throw), which leaves the
    // dapp on the in-iframe connect fallback.
    const origin = globalThis.location?.origin;
    if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
      params.set('parentOrigin', origin);
    }
  }

  const sep = path.includes('?') ? '&' : '?';
  return `${origin}${path}${sep}${params.toString()}`;
}

/**
 * Apply caller-supplied inline style overrides to the iframe.
 *
 * `height` is ignored unconditionally (the resize handler owns it).
 * `width` is also ignored from the generic `style` bag because the
 * dedicated `width` MountOption is the supported surface; entries passing
 * `style.width` are silently filtered to keep behaviour predictable when
 * both are supplied.
 */
function applyStyle(iframe: HTMLIFrameElement, style: CSSPropertiesLike | undefined): void {
  if (!style) return;
  for (const key of Object.keys(style)) {
    if (key === 'height' || key === 'width') continue;
    const value = style[key];
    // Only string values are applied. Numeric values (valid in React's
    // CSSProperties, e.g. zIndex: 1) are skipped on the vanilla path because
    // the iframe style setter expects CSS strings; integrators on the vanilla
    // surface should pass CSS strings.
    if (typeof value === 'string') {
      // CSSStyleDeclaration is a string-indexed setter; assignment is safe.
      (iframe.style as unknown as Record<string, string>)[key] = value;
    }
  }
}

/**
 * Apply the sizing MountOptions (`width`, `maxWidth`, `padding`) to the
 * iframe and its optional wrapper. Padding lives on the wrapper because
 * applying padding to an `<iframe>` element itself does not behave
 * intuitively across browsers (the padding sits inside the iframe's CSS
 * box but the document inside the iframe is unaffected, producing a
 * visible margin the embed page cannot control). When padding is not
 * supplied the wrapper is omitted entirely so a simple
 * `container > iframe` DOM shape is preserved for hosts using that
 * structural CSS selector.
 *
 * `height` is intentionally NOT touched here. The resize handler owns it.
 */
function applySizing(
  iframe: HTMLIFrameElement,
  wrapper: HTMLDivElement,
  opts: Pick<MountOptions, 'width' | 'maxWidth' | 'padding'>
): void {
  if (opts.width !== undefined) {
    iframe.style.width = opts.width;
  }
  if (opts.maxWidth !== undefined) {
    iframe.style.maxWidth = opts.maxWidth;
  }
  if (opts.padding !== undefined) {
    wrapper.style.padding = opts.padding;
  }
}

/**
 * Creates an iframe, appends it to the container, and connects to the widget.
 * Returns a handle for cleanup.
 */
export function mount(container: HTMLElement, opts: MountOptions = {}): MountResult {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('mount: container must be an HTMLElement');
  }
  // referralId default: 'general'. Hosts that do not pass an explicit
  // referralId (or pass an empty/whitespace-only string) embed the
  // general-pool variant, which fans the affiliate fee across all
  // participating Atom Circuit validators at sweep time. Passing an
  // explicit validator id keeps the prior single-validator behavior.
  const referralIdRaw = typeof opts.referralId === 'string'
    ? opts.referralId.trim()
    : '';
  const resolvedReferralId = referralIdRaw.length > 0 ? referralIdRaw : 'general';

  const warnSink: (message: string) => void =
    typeof console !== 'undefined' && typeof console.warn === 'function'
      ? (msg: string): void => {
          console.warn(msg);
        }
      : (): void => {
          /* no console available */
        };

  // Loading-overlay dismisser. Bound to a no-op until the loader element
  // is created below; reportError() and the ready-event handler capture
  // this closure binding so the eventual handler is the one that fires.
  let dismissLoader: () => void = (): void => { /* not yet wired */ };

  const reportError = (error: MountError): void => {
    // Always clear the loader on any error path so a permanent handshake
    // failure does not leave a forever-spinning state in the host page.
    dismissLoader();
    if (opts.onError) {
      opts.onError(error);
      return;
    }
    warnSink(`Atom Circuit embed: ${error.code}: ${error.message}`);
  };

  // Wrap the iframe in a dedicated div. The wrapper carries
  // position:relative so the pre-handshake loading overlay can absolutely
  // position over the iframe without affecting host page layout. It also
  // hosts any caller-supplied padding (iframes ignore their own padding
  // because the inner document does its own box-model). Hosts that
  // previously relied on the `container > iframe` selector should switch
  // to `container iframe` or `[data-atom-circuit-embed] iframe`. The
  // wrapper attribute is unchanged from earlier versions.
  const wrapper: HTMLDivElement = document.createElement('div');
  wrapper.setAttribute('data-atom-circuit-embed', '');
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  wrapper.style.display = 'block';

  const iframe = document.createElement('iframe');
  iframe.src = buildSrc({
    referralId: resolvedReferralId,
    ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    ...(opts.theme !== undefined ? { theme: opts.theme } : {}),
    ...(opts.chrome !== undefined ? { chrome: opts.chrome } : {}),
    ...(opts.allowReferralChoice !== undefined
      ? { allowReferralChoice: opts.allowReferralChoice }
      : {}),
    ...(opts.wallet !== undefined ? { wallet: opts.wallet } : {}),
    warn: warnSink,
  });
  iframe.setAttribute('sandbox', SANDBOX_ATTR);
  iframe.setAttribute('allow', 'clipboard-write; clipboard-read');
  iframe.setAttribute('title', 'Atom Circuit swap widget');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.style.colorScheme = 'normal';
  // Iframe sits at z-index 1 so the loader (z-index 2) overlays it during
  // handshake. Both are within the same stacking context (the wrapper).
  iframe.style.position = 'relative';
  iframe.style.zIndex = '1';
  applyStyle(iframe, opts.style);
  applySizing(iframe, wrapper, opts);
  if (opts.className) {
    iframe.className = opts.className;
  }

  // Pre-handshake loading overlay. Absolute-positioned within the wrapper,
  // pointer-events:none so user clicks pass straight to the iframe once
  // it's interactive. Color is a neutral mid-grey that reads on both
  // light and dark host backgrounds. Removed on the first ready event
  // OR on any onError dispatch (whichever fires first) so a permanent
  // handshake failure does not leave a spinning forever-state.
  const loader: HTMLDivElement = document.createElement('div');
  loader.setAttribute('data-atom-circuit-loader', '');
  loader.setAttribute('aria-hidden', 'true');
  loader.style.position = 'absolute';
  loader.style.inset = '0';
  loader.style.display = 'flex';
  loader.style.alignItems = 'center';
  loader.style.justifyContent = 'center';
  loader.style.pointerEvents = 'none';
  loader.style.color = '#888888';
  loader.style.transition = 'opacity 0.08s ease-out';
  loader.style.opacity = '1';
  loader.style.zIndex = '2';
  loader.innerHTML = LOADER_SVG;

  // Drive the spinner rotation via the Web Animations API. The SMIL
  // approach (the earlier shape of LOADER_SVG) renders a static frame
  // when the SVG is set via innerHTML during the initial page-load
  // phase on Chromium - exactly when the host needs the spinner to be
  // visibly spinning. WAAPI starts immediately and runs off the
  // browser's compositor thread without a JS rAF loop. The animation
  // is owned by the loader's SVG child, so removing the loader
  // (dismissLoader below) garbage-collects the animation too.
  const loaderSvg = loader.querySelector('svg');
  let spinAnimation: Animation | null = null;
  if (loaderSvg && typeof loaderSvg.animate === 'function') {
    // transform-origin via CSS on the SVG itself rather than inside the
    // keyframes so the rotation pivots about the SVG centre regardless
    // of how the host page sized the surrounding wrapper.
    (loaderSvg as SVGElement).style.transformOrigin = 'center';
    spinAnimation = loaderSvg.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 900, iterations: Infinity, easing: 'linear' },
    );
  }

  let loaderDismissed = false;
  dismissLoader = (): void => {
    if (loaderDismissed) return;
    loaderDismissed = true;
    loader.style.opacity = '0';
    // Cancel the spinner animation immediately so the rAF/compositor
    // work stops even before the fade-out completes.
    if (spinAnimation) {
      try { spinAnimation.cancel(); } catch { /* DOMException on detached node, safe to ignore */ }
      spinAnimation = null;
    }
    // Remove from DOM after the fade-out transition completes so it does
    // not eat pointer events or screen-reader focus.
    setTimeout(() => {
      if (loader.parentNode) loader.parentNode.removeChild(loader);
    }, 100);
  };

  // Forward native iframe network/load failures to onError. Browsers fire
  // `error` on the iframe element for resource failures (DNS, TLS, 5xx HTML
  // pages still fire `load`, so this only catches transport-level breakage).
  const onIframeError = (event: Event | string): void => {
    reportError({
      code: 'iframe_load_failed',
      message: 'Iframe failed to load the widget URL',
      cause: event,
    });
  };
  iframe.addEventListener('error', onIframeError);

  // Dismiss the loading overlay as soon as the iframe document fires
  // `load`. This is strictly earlier than the postMessage `ready`
  // handshake event because `load` only requires the iframe's HTML to
  // finish loading; the handshake additionally requires the dapp JS to
  // execute and respond. Without this listener the spinner stayed
  // visible for several hundred ms after the dapp had begun painting,
  // overlapping the swap UI. The ready-side dismissal is still wired
  // below as a backstop in case the load event is delayed by a slow
  // resource (the dismissLoader closure is idempotent).
  const onIframeLoad = (): void => {
    dismissLoader();
  };
  iframe.addEventListener('load', onIframeLoad);

  // If appendChild throws (e.g. the container is detached and the host's
  // custom element implementation rejects insertions), the error listener
  // would otherwise stay attached to a dangling iframe element. Detach it
  // and let the iframe go out of scope before re-throwing so callers see
  // the original DOM error without leaking the listener.
  try {
    wrapper.appendChild(iframe);
    wrapper.appendChild(loader);
    container.appendChild(wrapper);
  } catch (err) {
    iframe.removeEventListener('error', onIframeError);
    iframe.removeEventListener('load', onIframeLoad);
    throw err;
  }

  const client = new IframeClient({
    iframe,
    allowedOrigin: opts.origin ?? WIDGET_ORIGIN,
  });

  // Parent-page wallet bridge. The controller is created ONLY when the host
  // explicitly opts into mode 'parent'. In mode 'iframe' (or absent) it stays
  // null so the embed behaves exactly as today (invariant #1) and setWallet /
  // clearWallet are no-ops. The bridge resolves the widget origin from the same
  // origin surface the iframe src uses (opts.origin ?? WIDGET_ORIGIN), so a
  // custom test/staging origin is honored consistently across the src and the
  // bridge's origin/source checks.
  //
  // When handles are supplied at mount, they are wired immediately (equivalent
  // to mount + immediate setWallet, spec A.5). When mode is 'parent' but NO
  // handles are supplied yet (option Y: widget visible before connect), the
  // controller is still created and the iframe URL still carries
  // walletMode=parent&parentOrigin, so the integrator can call setWallet later
  // to wire the bridge with no remount.
  let walletBridge: WalletBridgeController | null = null;
  const walletOpts: WalletOptions | undefined = opts.wallet;
  if (walletOpts?.mode === 'parent') {
    walletBridge = createWalletBridge({
      iframe,
      widgetOrigin: resolveWidgetOrigin(opts.origin ?? WIDGET_ORIGIN),
      // Connect-prompt layer (spec A.4 / A.5). Presence of the handler drives
      // the iframe's actionable-vs-passive Connect UI via the capabilities
      // advert; connectPrompt overrides the passive prompt text.
      ...(opts.onWalletConnectRequest
        ? { onWalletConnectRequest: opts.onWalletConnectRequest }
        : {}),
      ...(opts.connectPrompt !== undefined
        ? { connectPrompt: opts.connectPrompt }
        : {}),
      warn: warnSink,
    });
    if (walletOpts.cosmos || walletOpts.evm) {
      walletBridge.setWallet({
        ...(walletOpts.cosmos ? { cosmos: walletOpts.cosmos } : {}),
        ...(walletOpts.evm ? { evm: walletOpts.evm } : {}),
      });
    }
  }

  const resize: ResizeHandle = attachResize({
    iframe,
    client,
    ...(opts.minHeight !== undefined ? { minHeight: opts.minHeight } : {}),
  });

  // Subscribe callbacks before init() so we never miss an early event.
  const subscriptions: Array<() => void> = [];
  if (opts.onReady) {
    const fn = opts.onReady;
    subscriptions.push(client.on('ready', (p: ReadyPayload) => fn(p)));
  }
  if (opts.onResize) {
    const fn = opts.onResize;
    subscriptions.push(client.on('resize', (info) => fn(info)));
  }
  if (opts.onSwapSubmitted) {
    const fn = opts.onSwapSubmitted;
    subscriptions.push(client.on('swap:submitted', (p: SwapSubmittedPayload) => fn(p)));
  }
  if (opts.onSwapBridging) {
    const fn = opts.onSwapBridging;
    subscriptions.push(client.on('swap:bridging', (p: SwapBridgingPayload) => fn(p)));
  }
  if (opts.onSwapSuccess) {
    const fn = opts.onSwapSuccess;
    subscriptions.push(client.on('swap:success', (p: SwapSuccessPayload) => fn(p)));
  }
  if (opts.onSwapError) {
    const fn = opts.onSwapError;
    subscriptions.push(client.on('swap:error', (p: SwapErrorPayload) => fn(p)));
  }

  // Race the underlying init() against an explicit handshake-timeout so the
  // host always sees an `onError` (or warn) within 15s even if Penpal's own
  // timeout machinery is bypassed by a future refactor.
  //
  // We also treat an early `ready` event as proof the bridge is alive: if
  // the iframe emits a ready event via the raw event stream, the embed is
  // working regardless of whether Penpal's internal connection.promise
  // resolves. Some host pages trigger asymmetric Penpal handshakes (the
  // iframe sees SYN/ACK done but the host's connection.promise rejects)
  // and we do not want to surface a spurious handshake_failed in that case.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let bridgeReady = false;
  const clearTimer = (): void => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };
  const readySuppressUnsub = client.on('ready', () => {
    bridgeReady = true;
    clearTimer();
    dismissLoader();
    readySuppressUnsub();
  });
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Iframe handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
    }, HANDSHAKE_TIMEOUT_MS);
  });

  Promise.race([client.init(), timeoutPromise])
    .then(() => {
      clearTimer();
    })
    .catch((err: unknown) => {
      clearTimer();
      const message = err instanceof Error ? err.message : String(err);
      const code: MountErrorCode = classifyInitError(message);
      // Suppress: the iframe already announced readiness via the event
      // stream, so the apparent init failure is a Penpal asymmetry, not a
      // real bridge failure. EXCEPTION: a protocol-incompatible handshake
      // (major-version mismatch) must always surface even though the iframe
      // may still have emitted a `ready` event - it is a genuine bring-up
      // failure the host needs to handle, not a transport asymmetry.
      if (bridgeReady && code !== 'protocol_incompatible') return;
      // Suppress: the host already destroyed this mount (e.g. React
      // StrictMode double-effect in dev). The pending init() promise will
      // still reject when its underlying timeout fires, but there is no
      // consumer to surface the error to and emitting it would log a
      // spurious handshake_failed against the unmounted instance.
      if (destroyed) return;
      reportError({ code, message, cause: err });
    });

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    iframe.removeEventListener('error', onIframeError);
    iframe.removeEventListener('load', onIframeLoad);
    for (const unsub of subscriptions) unsub();
    resize.destroy();
    client.destroy();
    // Tear down the wallet bridge (cosmiframe unlisten + EVM message listener
    // + provider event subscriptions) so unmount leaves no leaked listeners.
    if (walletBridge) {
      walletBridge.teardown();
      walletBridge = null;
    }
    // Clear the loader's pending fade-out timer side-effect if it has not
    // yet fired. Idempotent because dismissLoader gates on a sentinel.
    dismissLoader();
    // Remove the wrapper which carries both the iframe and the loader.
    // Fall back to removing the iframe alone if the wrapper has already
    // been detached by host code.
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    } else if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  // Post-mount wallet handoff (spec A.5). No-op when the embed was not mounted
  // in mode 'parent' (no controller exists) or after destroy().
  const setWallet: MountResult['setWallet'] = (handles) => {
    if (destroyed || !walletBridge) return;
    walletBridge.setWallet(handles);
  };
  const clearWallet: MountResult['clearWallet'] = (channels) => {
    if (destroyed || !walletBridge) return;
    walletBridge.clearWallet(channels);
  };

  return { iframe, wrapper, client, setWallet, clearWallet, destroy };
}

/**
 * Maps an init-time error message to a stable {@link MountErrorCode}. Kept
 * conservative: anything we cannot positively identify becomes 'unknown'
 * rather than masquerading as a more specific code.
 */
function classifyInitError(message: string): MountErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('handshake') || lower.includes('timed out') || lower.includes('timeout')) {
    return 'handshake_failed';
  }
  if (lower.includes('protocol mismatch') || lower.includes('protocolversion')) {
    return 'protocol_incompatible';
  }
  // 'allowed origin' / 'origin mismatch' are our own strings; the noisier
  // 'Invalid target origin' from postMessage gets classified as 'unknown'.
  if (lower.includes('origin mismatch') || lower.includes('allowed origin')) {
    return 'origin_mismatch';
  }
  if (lower.includes('contentwindow') || lower.includes('iframe failed') || lower.includes('load')) {
    return 'iframe_load_failed';
  }
  return 'unknown';
}

/**
 * Exposed for tests and callers that want to compute the iframe URL without
 * mounting (e.g. for SSR `<link rel="preconnect">` hints).
 *
 * A `theme` may be supplied; validation failures cause the theme param to
 * be silently omitted (matching `mount()` behaviour). Pass an optional
 * `warn` sink to observe validation failures during tests.
 */
export function buildIframeSrc(
  opts: Pick<
    MountOptions,
    | 'referralId'
    | 'origin'
    | 'path'
    | 'theme'
    | 'chrome'
    | 'allowReferralChoice'
    | 'wallet'
  > & {
    readonly warn?: (message: string) => void;
  }
): string {
  // Apply the same referralId default as mount(): undefined / empty /
  // whitespace-only collapses to 'general'.
  const raw = typeof opts.referralId === 'string' ? opts.referralId.trim() : '';
  const resolvedReferralId = raw.length > 0 ? raw : 'general';
  return buildSrc({ ...opts, referralId: resolvedReferralId });
}
