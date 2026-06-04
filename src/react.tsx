/**
 * React wrapper. Imports are kept narrow so the bundle stays small when only
 * the `./react` subpath is consumed.
 *
 * SSR-safe: renders nothing on the server (returns null until the effect
 * runs in the browser). The host should still wrap this in a `dynamic`
 * import with `ssr: false` when using Next.js App Router to avoid pulling
 * iframe-only code into the server bundle.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
} from 'react';

import { mount, type MountResult } from './mount.js';
import type {
  ChromeOptions,
  MountError,
  MountErrorCode,
  MountOptions,
  ReadyPayload,
  SwapErrorPayload,
  SwapRouteSummary,
  SwapSubmittedPayload,
  SwapSuccessPayload,
  ThemeOptions,
  WalletChannel,
  WalletCosmosHandle,
  WalletEvmHandle,
  WalletOptions,
} from './protocol.js';

export type {
  ChromeOptions,
  MountError,
  MountErrorCode,
  MountResult,
  ReadyPayload,
  SwapErrorPayload,
  SwapRouteSummary,
  SwapSubmittedPayload,
  SwapSuccessPayload,
  ThemeOptions,
  WalletOptions,
};

export interface AtomCircuitSwapProps {
  /**
   * Validator-supplied affiliate identifier. Optional - defaults to
   * `'general'` when omitted. See {@link MountOptions.referralId}.
   */
  referralId?: string;
  /**
   * Override the widget origin. Defaults to `https://atomcircuit.net`.
   */
  origin?: string;
  /**
   * Override the widget path. Defaults to `/embed/swap`.
   */
  path?: string;
  /**
   * Minimum iframe height; default `480px`.
   */
  minHeight?: string;
  /**
   * CSS class applied to the WRAPPER `<div>` (not the iframe). This differs
   * from vanilla `mount()`, where `className` applies to the IFRAME element.
   */
  className?: string;
  /**
   * Inline style applied to the WRAPPER `<div>` (not the iframe). This differs
   * from vanilla `mount()`, where `style` applies to the IFRAME element.
   */
  style?: CSSProperties;
  /** Fires once the handshake completes. */
  onReady?: (payload: ReadyPayload) => void;
  /** Fires on every measured content-height change. */
  onResize?: (info: { height: number }) => void;
  /** Fires when a user submits a swap. */
  onSwapSubmitted?: (payload: SwapSubmittedPayload) => void;
  /** Fires when a submitted swap confirms on chain. */
  onSwapSuccess?: (payload: SwapSuccessPayload) => void;
  /** Fires when a swap fails or is rejected by the wallet. */
  onSwapError?: (payload: SwapErrorPayload) => void;
  /** Fires on SDK-level failures (handshake timeout, iframe load failure, origin mismatch). */
  onError?: (error: MountError) => void;
  /**
   * Optional theme. Forwarded to the iframe URL as a validated, base64-encoded
   * payload. Validation failures silently drop the theme; the iframe falls
   * back to its defaults. See {@link ThemeOptions}.
   */
  theme?: ThemeOptions;
  /**
   * Optional chrome toggles. Each flag hides the corresponding embed surface
   * (logo, wallet button, validator badge, footer) when false. Defaults are
   * all-on so an embed dropped in with no chrome configuration retains the
   * full surface. See {@link ChromeOptions}.
   */
  chrome?: ChromeOptions;
  /**
   * Whether the embed lets the end user choose which validator the swap
   * affiliate fee stakes to. Default `false`. When `false`, `referralId` is
   * the fixed affiliate (unchanged behaviour). When `true`, the embed renders
   * an interactive validator picker with `referralId` pre-selected as the
   * default (or the `general` pool when unset); the user's pick persists and
   * the picker shows regardless of the `chrome.validator` badge toggle. See
   * {@link MountOptions.allowReferralChoice}.
   */
  allowReferralChoice?: boolean;
  /** CSS width for the iframe. Default `'100%'`. */
  width?: string;
  /** CSS max-width for the iframe. Default unset. */
  maxWidth?: string;
  /**
   * CSS padding applied to the wrapping div around the iframe (NOT the
   * iframe element itself). Default `'0'`.
   */
  padding?: string;
  /**
   * Optional parent-page wallet reuse. See {@link WalletOptions}. Omitting
   * this prop, or setting `wallet.mode` to `'iframe'` (the default), behaves
   * exactly as today (in-iframe connect). Setting `wallet.mode` to `'parent'`
   * reuses the integrator's already-connected wallet over the postMessage
   * bridge.
   *
   * LATE CONNECT (option Y): a React integrator can render the widget
   * IMMEDIATELY with `wallet={{ mode: 'parent' }}` and NO handles, then supply
   * the `cosmos` / `evm` handles later (once the user connects their wallet on
   * the parent page) simply by passing them in this same prop on a subsequent
   * render. The wrapper detects the handle change and calls `setWallet` on the
   * live mount under the hood - NO remount, NO reconnect. Clearing a handle
   * (passing `wallet` without that channel, or back to `{ mode: 'parent' }`)
   * calls `clearWallet` for the removed channel. Switching `mode` between
   * `'iframe'` and `'parent'` DOES remount (mode bakes into the iframe URL).
   */
  wallet?: WalletOptions;
  /**
   * Parent-mode connect-prompt handler (spec Appendix A.4 / A.5). Invoked when
   * the iframe user clicks Connect in parent mode for a not-yet-bridged channel.
   * The integrator runs THEIR own connect flow for that channel and calls
   * `setWallet` (passes the `cosmos` / `evm` handle on a later render) on
   * success. Presence drives whether the iframe shows an actionable Connect
   * button (handler present) or the passive {@link AtomCircuitSwapProps.connectPrompt}
   * text (absent). The callback identity may change between renders WITHOUT a
   * remount - the latest one is always the one invoked. See
   * {@link MountOptions.onWalletConnectRequest}.
   */
  onWalletConnectRequest?: (channel: WalletChannel) => void;
  /**
   * Override text for the passive not-connected prompt shown in the iframe when
   * no {@link AtomCircuitSwapProps.onWalletConnectRequest} handler exists.
   * Forwarded to the iframe in the `capabilities` reply. See
   * {@link MountOptions.connectPrompt}.
   */
  connectPrompt?: string;
}

const WRAPPER_STYLE: CSSProperties = {
  width: '100%',
  display: 'block',
};

/**
 * React component wrapping `mount()`. Mounts on first effect tick, unmounts
 * on cleanup. Callbacks are captured via a ref so updating them between
 * renders does not re-mount the iframe.
 */
export function AtomCircuitSwap(props: AtomCircuitSwapProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // The live mount handle, shared between the mount effect (which creates it)
  // and the late-connect effect (which drives setWallet/clearWallet on it).
  const handleRef = useRef<MountResult | null>(null);
  // The wallet handles last pushed to the bridge, tracked by object identity
  // so the late-connect effect can diff appear / change / disappear per
  // channel. Reset whenever the iframe is (re)mounted, since a fresh mount
  // starts with whatever handles were passed at mount time.
  const lastCosmosRef = useRef<WalletCosmosHandle | undefined>(undefined);
  const lastEvmRef = useRef<WalletEvmHandle | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const opts: MountOptions = {
      referralId: propsRef.current.referralId,
      ...(propsRef.current.origin !== undefined ? { origin: propsRef.current.origin } : {}),
      ...(propsRef.current.path !== undefined ? { path: propsRef.current.path } : {}),
      ...(propsRef.current.minHeight !== undefined ? { minHeight: propsRef.current.minHeight } : {}),
      ...(propsRef.current.theme !== undefined ? { theme: propsRef.current.theme } : {}),
      ...(propsRef.current.chrome !== undefined ? { chrome: propsRef.current.chrome } : {}),
      ...(propsRef.current.allowReferralChoice !== undefined
        ? { allowReferralChoice: propsRef.current.allowReferralChoice }
        : {}),
      ...(propsRef.current.width !== undefined ? { width: propsRef.current.width } : {}),
      ...(propsRef.current.maxWidth !== undefined ? { maxWidth: propsRef.current.maxWidth } : {}),
      ...(propsRef.current.padding !== undefined ? { padding: propsRef.current.padding } : {}),
      ...(propsRef.current.wallet !== undefined ? { wallet: propsRef.current.wallet } : {}),
      ...(propsRef.current.connectPrompt !== undefined
        ? { connectPrompt: propsRef.current.connectPrompt }
        : {}),
      // Forward the connect-prompt handler via a STABLE wrapper that reads the
      // latest prop from propsRef. The controller advertises capability based on
      // whether a handler exists at mount; passing this wrapper whenever the prop
      // was supplied keeps `canRequestConnect` correct, while the indirection
      // means a changed callback identity needs NO remount (the current callback
      // is always the one invoked). Only wired when the prop is present at mount
      // so an embed with no handler advertises canRequestConnect=false.
      ...(propsRef.current.onWalletConnectRequest !== undefined
        ? {
            onWalletConnectRequest: (channel: WalletChannel): void =>
              propsRef.current.onWalletConnectRequest?.(channel),
          }
        : {}),
      onReady: (payload) => propsRef.current.onReady?.(payload),
      onResize: (info) => propsRef.current.onResize?.(info),
      onSwapSubmitted: (payload) => propsRef.current.onSwapSubmitted?.(payload),
      onSwapSuccess: (payload) => propsRef.current.onSwapSuccess?.(payload),
      onSwapError: (payload) => propsRef.current.onSwapError?.(payload),
      onError: (error) => propsRef.current.onError?.(error),
    };

    let handle: MountResult | null = null;
    try {
      handle = mount(container, opts);
    } catch {
      handle = null;
    }
    handleRef.current = handle;
    // Seed the per-channel identity trackers with whatever was passed at mount
    // time (mount() already wired those handles itself, so the late-connect
    // effect must not re-push them on its first run).
    lastCosmosRef.current = propsRef.current.wallet?.cosmos;
    lastEvmRef.current = propsRef.current.wallet?.evm;
    return () => {
      handle?.destroy();
      handleRef.current = null;
      lastCosmosRef.current = undefined;
      lastEvmRef.current = undefined;
    };
    // referralId / origin / path warrant a re-mount; so does wallet.mode, which
    // bakes into the iframe URL (a change there cannot be applied to a live
    // iframe and must rebuild it). Handle identity (wallet.cosmos / wallet.evm)
    // is handled by the late-connect effect below WITHOUT a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.referralId,
    props.origin,
    props.path,
    props.wallet?.mode,
  ]);

  // Late-connect / disconnect (option Y). Runs after every render whose wallet
  // handle identity changed. Diffs each channel against the last pushed handle
  // and drives setWallet (appear / replace) or clearWallet (disappear) on the
  // live mount, with NO remount. A no-op unless the embed was mounted in mode
  // 'parent' (mount() only builds a bridge controller in that mode; setWallet /
  // clearWallet are inert otherwise).
  const cosmosHandle = props.wallet?.cosmos;
  const evmHandle = props.wallet?.evm;
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const prevCosmos = lastCosmosRef.current;
    const prevEvm = lastEvmRef.current;

    // Build a single setWallet call for any channel that newly appeared or
    // changed identity, and a clearWallet list for any that disappeared. One
    // setWallet + one clearWallet at most per change keeps the ready/gone
    // signal traffic minimal.
    const toSet: { cosmos?: WalletCosmosHandle; evm?: WalletEvmHandle } = {};
    const toClear: Array<'cosmos' | 'evm'> = [];

    if (cosmosHandle !== prevCosmos) {
      if (cosmosHandle) toSet.cosmos = cosmosHandle;
      else toClear.push('cosmos');
    }
    if (evmHandle !== prevEvm) {
      if (evmHandle) toSet.evm = evmHandle;
      else toClear.push('evm');
    }

    if (toClear.length > 0) handle.clearWallet(toClear);
    if (toSet.cosmos || toSet.evm) handle.setWallet(toSet);

    lastCosmosRef.current = cosmosHandle;
    lastEvmRef.current = evmHandle;
  }, [cosmosHandle, evmHandle]);

  // Filter `height` and `width` out of the caller's `style` before spreading it
  // onto the wrapper, matching the vanilla mount() applyStyle() contract: those
  // dimensions are managed by the SDK (the resize handler owns height; the
  // `width` / `maxWidth` props own width), so a `style.width` must not override
  // WRAPPER_STYLE and a `style.height` must not apply. Documented behaviour is
  // that both are ignored in `style` on BOTH surfaces.
  let wrapperStyle: CSSProperties = WRAPPER_STYLE;
  if (props.style) {
    const { height: _height, width: _width, ...rest } = props.style;
    wrapperStyle = { ...WRAPPER_STYLE, ...rest };
  }

  // Returning the container synchronously is safe on the server because the
  // child iframe is only created inside the effect.
  //
  // NOTE: this outer container does NOT carry `data-atom-circuit-embed`. The
  // SDK-managed wrapper that mount() appends inside it does (mount.ts), so the
  // documented `[data-atom-circuit-embed] iframe` selector matches exactly one
  // element on both the vanilla and React surfaces. Setting it here too would
  // make the selector match two nested elements in React.
  return (
    <div
      ref={containerRef}
      className={props.className}
      style={wrapperStyle}
    />
  );
}
