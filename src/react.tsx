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
   * CSS class applied to the wrapping `<div>`.
   */
  className?: string;
  /**
   * Inline style applied to the wrapping `<div>`.
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
  /** CSS width for the iframe. Default `'100%'`. */
  width?: string;
  /** CSS max-width for the iframe. Default unset. */
  maxWidth?: string;
  /**
   * CSS padding applied to the wrapping div around the iframe (NOT the
   * iframe element itself). Default `'0'`.
   */
  padding?: string;
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
      ...(propsRef.current.width !== undefined ? { width: propsRef.current.width } : {}),
      ...(propsRef.current.maxWidth !== undefined ? { maxWidth: propsRef.current.maxWidth } : {}),
      ...(propsRef.current.padding !== undefined ? { padding: propsRef.current.padding } : {}),
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
    return () => {
      handle?.destroy();
    };
    // referralId / origin / path are the only props that warrant a re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.referralId, props.origin, props.path]);

  const wrapperStyle: CSSProperties = props.style
    ? { ...WRAPPER_STYLE, ...props.style }
    : WRAPPER_STYLE;

  // Returning the container synchronously is safe on the server because the
  // child iframe is only created inside the effect.
  return (
    <div
      ref={containerRef}
      className={props.className}
      style={wrapperStyle}
      data-atom-circuit-embed=""
    />
  );
}
