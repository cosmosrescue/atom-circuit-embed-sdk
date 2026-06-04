/**
 * Parent-side wallet bridge (open source). Exposes the integrator's
 * already-connected wallet to the embedded Atom Circuit iframe over
 * postMessage, so the end user does not reconnect inside the widget.
 *
 * Two independent channels, each wired only when the caller supplies a handle:
 *
 * - Cosmos: delegates entirely to @dao-dao/cosmiframe's `Cosmiframe.listen`.
 *   Cosmiframe enforces origin + source checks natively on both sides; we pass
 *   the widget origin as the single allowed child origin. Keys never leave the
 *   integrator's wallet; only offline-signer method calls are proxied. In parent
 *   mode the listener is installed when the controller is created, before any
 *   wallet handle is supplied, so the parent answers the embed's `isCosmiframe`
 *   and `getMetadata` handshake probes the instant the iframe mounts. The signer
 *   target is filled in lazily by `setWallet` against a mutable holder; calls
 *   that arrive before a handle is set reject cleanly.
 *
 * - EVM: a custom postMessage relay implementing the `atomcircuit:evm` envelope
 *   (see protocol.ts / spec Appendix A.3). Every inbound message is validated
 *   on event.origin AND event.source before it touches the provider; every
 *   outbound message targets the iframe origin explicitly, never '*'.
 *
 * The trust model (spec section 2): the iframe requests signatures, the wallet
 * shows its own confirmation UI, and the origin allowlist is the front-line
 * control. This module is the relay layer; the wallet UI remains the
 * authoritative backstop.
 */

import { Cosmiframe } from '@dao-dao/cosmiframe';

import {
  EVM_BRIDGE_NS,
  WALLET_SIGNAL_NS,
  WIDGET_ORIGIN,
  isEvmRequestMessage,
  isWalletConnectRequestMessage,
  isWalletHelloMessage,
  type EvmEventMessage,
  type EvmResponseMessage,
  type WalletCapabilitiesMessage,
  type WalletChannel,
  type WalletCosmosHandle,
  type WalletEvmHandle,
  type WalletSignalMessage,
} from './protocol.js';

/**
 * Options for {@link wireWalletBridge}.
 */
export interface WalletBridgeOptions {
  /** The mounted iframe element whose contentWindow we bridge to. */
  readonly iframe: HTMLIFrameElement;
  /**
   * The resolved widget origin (scheme + host + optional port). This is BOTH
   * the origin the parent expects inbound messages from AND the origin it
   * targets outbound messages to, because the iframe is served from it. Pass
   * the same value the SDK uses to build the iframe src (`opts.origin ??
   * WIDGET_ORIGIN`), normalized to an origin via {@link resolveWidgetOrigin}.
   */
  readonly widgetOrigin: string;
  /** Cosmos wallet handle. When present, the Cosmos bridge is wired. */
  readonly cosmos?: WalletCosmosHandle;
  /** EVM wallet handle. When present, the EVM bridge is wired. */
  readonly evm?: WalletEvmHandle;
  /**
   * Connect-prompt handler (spec Appendix A.4). When present, the parent
   * advertises `canRequestConnect.{cosmos,evm} = true` in its capabilities reply
   * and invokes this on an inbound `connect-request`. The single per-channel
   * handler services both channels.
   */
  readonly onWalletConnectRequest?: (channel: WalletChannel) => void;
  /** Optional passive-prompt text override forwarded to the iframe in `capabilities`. */
  readonly connectPrompt?: string;
  /** Optional warn sink for non-fatal bridge diagnostics. */
  readonly warn?: (message: string) => void;
}

/**
 * Handle returned by {@link wireWalletBridge}. `teardown()` is idempotent and
 * removes every listener / provider subscription the bridge installed.
 */
export interface WalletBridgeHandle {
  teardown(): void;
}

/**
 * cosmos-kit's native cosmiframe account-change relay event name. When the
 * parent posts a message whose `.event` field equals this string to the iframe,
 * cosmos-kit's WalletManager (cjs/manager.js `_handleCosmiframeKeystoreChangeEvent`,
 * lines ~373-382) rebroadcasts it as a window event and calls
 * `_reconnect('cosmiframe')`, which re-reads the account from the parent target
 * via the cosmiframe wallet. This is how an account switch on the parent
 * propagates into the iframe (spec section 5.6, BUG A). The value is verified
 * against @cosmos-kit/core cjs/cosmiframe/constants.js
 * `COSMIFRAME_KEYSTORECHANGE_EVENT`. It is wallet-agnostic: the trigger is a
 * re-`setWallet` on an already-wired cosmos channel, not any wallet-specific
 * `*_keystorechange` event.
 */
const COSMIFRAME_KEYSTORECHANGE_EVENT = 'cosmiframe_keystorechange';

/**
 * The exact relay message cosmos-kit's manager listens for. `event.data` must be
 * an object with an `event` field equal to {@link COSMIFRAME_KEYSTORECHANGE_EVENT}
 * (manager.js checks `typeof event.data === 'object' && 'event' in event.data &&
 * event.data.event === COSMIFRAME_KEYSTORECHANGE_EVENT`). This is cosmos-kit's
 * own wire format, NOT one of our {@link WALLET_SIGNAL_NS} envelopes.
 */
interface CosmiframeKeystoreChangeMessage {
  readonly event: typeof COSMIFRAME_KEYSTORECHANGE_EVENT;
}

/**
 * Normalize a configured widget origin (which may carry a path or trailing
 * slash, since it shares the `opts.origin` surface) into a bare origin string
 * suitable for postMessage targeting and equality comparison. Falls back to
 * the canonical {@link WIDGET_ORIGIN} when the input is empty or unparseable
 * (e.g. a relative path in a test harness), so the bridge never silently
 * widens to '*'.
 */
export function resolveWidgetOrigin(configured?: string): string {
  if (!configured) return WIDGET_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return WIDGET_ORIGIN;
  }
}

/**
 * Wire the parent-side wallet bridge for the given iframe. Wires only the
 * channel(s) for which a handle is supplied, then posts the Appendix A.4
 * `ready` signal listing those channels to the iframe origin. Returns a
 * teardown handle the caller (mount's destroy path) must invoke on unmount;
 * teardown posts the `gone` signal for the wired channels.
 *
 * This is the one-shot convenience form used when handles are known at wire
 * time. For the late-connect / re-initializable case (spec A.5 setWallet) use
 * {@link createWalletBridge}, which this function is implemented on top of.
 */
export function wireWalletBridge(
  options: WalletBridgeOptions
): WalletBridgeHandle {
  const controller = createWalletBridge({
    iframe: options.iframe,
    widgetOrigin: options.widgetOrigin,
    ...(options.onWalletConnectRequest
      ? { onWalletConnectRequest: options.onWalletConnectRequest }
      : {}),
    ...(options.connectPrompt !== undefined
      ? { connectPrompt: options.connectPrompt }
      : {}),
    ...(options.warn ? { warn: options.warn } : {}),
  });
  controller.setWallet({
    ...(options.cosmos ? { cosmos: options.cosmos } : {}),
    ...(options.evm ? { evm: options.evm } : {}),
  });
  return { teardown: () => controller.teardown() };
}

/* ------------------------------------------------------------------------- */
/* Re-initializable controller (spec A.5: setWallet / clearWallet)            */
/* ------------------------------------------------------------------------- */

/**
 * Options for {@link createWalletBridge}. No handles up front: channels are
 * wired later via {@link WalletBridgeController.setWallet}. This supports the
 * "widget visible before connect" path (option Y) where the integrator mounts
 * immediately and supplies the wallet once the user connects on the parent.
 */
export interface WalletBridgeControllerOptions {
  readonly iframe: HTMLIFrameElement;
  readonly widgetOrigin: string;
  /**
   * Connect-prompt handler (spec Appendix A.4). Presence drives the
   * `capabilities` advert (`canRequestConnect.{cosmos,evm}`) and is invoked on
   * an inbound `connect-request`. The single per-channel handler can service
   * both channels.
   */
  readonly onWalletConnectRequest?: (channel: WalletChannel) => void;
  /** Optional passive-prompt text override forwarded to the iframe in `capabilities`. */
  readonly connectPrompt?: string;
  readonly warn?: (message: string) => void;
}

/**
 * A stateful per-channel wallet bridge. Each channel (cosmos / evm) can be
 * wired and torn down independently and repeatedly. Every successful
 * (re)wiring posts the Appendix A.4 `ready` signal for the affected channels;
 * every teardown posts `gone`. The iframe drives auto-adoption off those
 * signals (spec section 5.5).
 */
export interface WalletBridgeController {
  /**
   * (Re)wire the supplied channel(s) and post a `ready` signal listing them. If
   * a channel was already wired it is torn down first (replace semantics), so
   * calling setWallet again with a fresh handle re-adopts cleanly.
   */
  setWallet(handles: {
    cosmos?: WalletCosmosHandle;
    evm?: WalletEvmHandle;
  }): void;
  /**
   * Tear down the given channel(s) (or all wired channels when omitted) and
   * post a `gone` signal for whichever were actually wired.
   */
  clearWallet(channels?: readonly WalletChannel[]): void;
  /** Tear down every wired channel. Posts `gone` for the wired channels. */
  teardown(): void;
}

/**
 * Create a re-initializable wallet bridge controller. Wires nothing until
 * {@link WalletBridgeController.setWallet} is called.
 */
export function createWalletBridge(
  options: WalletBridgeControllerOptions
): WalletBridgeController {
  const { iframe, widgetOrigin, onWalletConnectRequest, connectPrompt, warn } =
    options;

  // Per-channel teardown fns. Presence of a key == that channel is wired.
  // The cosmos entry tracks LOGICAL wiring (a handle is present) for `ready` /
  // `gone` signalling and replace semantics; the cosmiframe LISTENER itself is
  // installed once at controller creation (see below), independent of whether a
  // handle is set, so the parent answers the child's mount-time handshake even
  // before any wallet connects.
  const wired = new Map<WalletChannel, () => void>();
  let destroyed = false;

  // Mutable cosmos handle holder. The cosmiframe listener (installed at creation)
  // reads the CURRENT handle through this holder on every proxied call. `null`
  // means no wallet is connected yet: handshake probes (isCosmiframe /
  // getMetadata) still answer, but proxied target / signer calls reject cleanly.
  const cosmosHolder: CosmosHandleHolder = {
    handle: null,
    metadataView: {},
  };

  // Install the cosmiframe listener immediately in parent mode so the embedded
  // widget's one-shot `isReady()` handshake (a 500ms isCosmiframe probe posted
  // on iframe mount) is answered before any wallet is connected, and so a
  // mount-time auto-reconnect cannot race the parent's later setWallet.
  const teardownCosmosListener = installCosmosListener(
    iframe,
    widgetOrigin,
    cosmosHolder
  );

  const post = (
    message: WalletSignalMessage | CosmiframeKeystoreChangeMessage
  ): void => {
    const target = iframe.contentWindow;
    if (!target) return;
    try {
      // Always target the iframe origin explicitly. Never '*'.
      target.postMessage(message, widgetOrigin);
    } catch {
      // postMessage can throw if the iframe is mid-teardown / detached (the
      // contentWindow is gone or cross-origin-throwy). Signals are best-effort;
      // a failed post must never break teardown or a setWallet/clearWallet call.
    }
  };

  // ---------------------------------------------------------------------------
  // Wallet CONTROL channel (Appendix A.4): hello -> capabilities, and
  // connect-request -> onWalletConnectRequest. Same origin + source discipline
  // as the EVM relay: a message is acted on only when event.origin === the
  // widget origin AND event.source === the iframe's contentWindow. This listener
  // is independent of the per-channel EVM relay (which is wired only when an EVM
  // handle is present), so the control channel works even before any wallet is
  // bridged (option Y: the iframe says hello while still unconnected).
  const onControlMessage = (event: MessageEvent): void => {
    if (destroyed) return;
    if (event.origin !== widgetOrigin) return;
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;

    if (isWalletHelloMessage(data)) {
      // The integrator registered a single per-channel connect handler; it can
      // service both channels (cosmos + evm). Capability is true iff a handler
      // exists; a channel the integrator cannot actually service is the
      // integrator's no-op to handle in their callback.
      const canRequest = !!onWalletConnectRequest;
      const capabilities: WalletCapabilitiesMessage = {
        ns: WALLET_SIGNAL_NS,
        kind: 'capabilities',
        canRequestConnect: { cosmos: canRequest, evm: canRequest },
        ...(connectPrompt !== undefined ? { connectPrompt } : {}),
      };
      post(capabilities);

      // Late-listener race: if a channel is already wired at hello time (the
      // integrator connected before the iframe's control listener attached),
      // (re)post `ready` for those channels so the iframe adopts. Without this
      // the iframe could miss the initial `ready` posted by setWallet.
      const alreadyWired: WalletChannel[] = [];
      for (const channel of ['cosmos', 'evm'] as const) {
        if (wired.has(channel)) alreadyWired.push(channel);
      }
      if (alreadyWired.length > 0) {
        post({ ns: WALLET_SIGNAL_NS, kind: 'ready', channels: alreadyWired });
      }
      return;
    }

    if (isWalletConnectRequestMessage(data)) {
      // Guard for absence: a connect-request with no registered handler is a
      // no-op (the iframe should not have shown an actionable button without a
      // prior `canRequestConnect: true`, but defend anyway).
      if (onWalletConnectRequest) {
        try {
          onWalletConnectRequest(data.channel);
        } catch (err) {
          if (warn) {
            const message = err instanceof Error ? err.message : String(err);
            warn(
              `Atom Circuit embed: onWalletConnectRequest threw for ${data.channel}: ${message}`
            );
          }
        }
      }
      return;
    }
  };

  window.addEventListener('message', onControlMessage);

  const tearDownChannel = (channel: WalletChannel): boolean => {
    const fn = wired.get(channel);
    if (!fn) return false;
    wired.delete(channel);
    try {
      fn();
    } catch {
      /* teardown must never throw; one channel cannot block another */
    }
    return true;
  };

  const setWallet: WalletBridgeController['setWallet'] = (handles) => {
    if (destroyed) return;
    // Channels being wired for the FIRST time -> post the A.4 `ready` signal so
    // the iframe auto-adopts (no picker). Channels that were ALREADY wired and
    // are being re-set (e.g. the user switched account on the parent) must NOT
    // re-post `ready` - the dapp no-ops a repeat `ready` because the channel is
    // already adopted. Instead, for cosmos, post cosmos-kit's native
    // `cosmiframe_keystorechange` relay so the manager re-reads the account from
    // the (now-updated) parent target (spec 5.6 BUG A, wallet-agnostic).
    const adopted: WalletChannel[] = [];
    let cosmosReWired = false;

    if (handles.cosmos) {
      const wasWired = wired.has('cosmos');
      // The listener is already installed; (re)wiring cosmos just swaps the held
      // handle so the always-listening cosmiframe proxy now targets the fresh
      // wallet's target + signer getters. The `wired` entry tracks logical
      // presence (drives ready/gone + replace semantics); its teardown clears
      // the holder, never the listener.
      cosmosHolder.handle = handles.cosmos;
      syncCosmosMetadata(cosmosHolder);
      wired.set('cosmos', () => {
        cosmosHolder.handle = null;
        syncCosmosMetadata(cosmosHolder);
      });
      if (wasWired) {
        cosmosReWired = true;
      } else {
        adopted.push('cosmos');
      }
    }
    if (handles.evm) {
      // EVM account changes propagate via the provider's own
      // `accountsChanged` event forwarding (see wireEvmBridge), so a re-set of
      // an already-wired EVM channel does not need the cosmos keystorechange
      // relay. We still re-wire (replace) and only re-announce `ready` on the
      // first wire to drive initial adoption.
      const wasWired = wired.has('evm');
      tearDownChannel('evm');
      wired.set('evm', wireEvmBridge(iframe, widgetOrigin, handles.evm, warn));
      if (!wasWired) adopted.push('evm');
    }

    if (adopted.length > 0) {
      // Appendix A.4: announce the now-available channels so the iframe
      // auto-adopts them with no picker.
      post({ ns: WALLET_SIGNAL_NS, kind: 'ready', channels: adopted });
    }
    if (cosmosReWired) {
      // Wallet-agnostic account-change relay (spec 5.6 BUG A). Posting the
      // native cosmos-kit message makes its manager call
      // `_reconnect('cosmiframe')`, re-reading getSimpleAccount/getAccount from
      // the parent target - reflecting whatever account/wallet is now current.
      post({ event: COSMIFRAME_KEYSTORECHANGE_EVENT });
    }
  };

  const clearWallet: WalletBridgeController['clearWallet'] = (channels) => {
    if (destroyed) return;
    const targets: readonly WalletChannel[] =
      channels && channels.length > 0 ? channels : (['cosmos', 'evm'] as const);
    const removed: WalletChannel[] = [];
    for (const channel of targets) {
      if (tearDownChannel(channel)) removed.push(channel);
    }
    if (removed.length > 0) {
      post({ ns: WALLET_SIGNAL_NS, kind: 'gone', channels: removed });
    }
  };

  const teardown = (): void => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('message', onControlMessage);
    const removed: WalletChannel[] = [];
    for (const channel of ['cosmos', 'evm'] as const) {
      if (tearDownChannel(channel)) removed.push(channel);
    }
    // Remove the always-installed cosmiframe listener on full teardown (the
    // controller is going away). clearWallet, by contrast, only clears the held
    // handle and leaves the listener in place so a later setWallet re-adopts.
    try {
      teardownCosmosListener();
    } catch {
      /* cosmiframe unlisten is best-effort */
    }
    if (removed.length > 0) {
      post({ ns: WALLET_SIGNAL_NS, kind: 'gone', channels: removed });
    }
  };

  return { setWallet, clearWallet, teardown };
}

/* ------------------------------------------------------------------------- */
/* Cosmos channel (delegates to cosmiframe)                                   */
/* ------------------------------------------------------------------------- */

/**
 * Cosmiframe's ListenOptions types. Its signer getters are typed against the
 * concrete @cosmjs offline-signer interfaces. Our public
 * {@link WalletCosmosHandle} keeps them structurally loose (OfflineSignerLike)
 * to avoid leaking a hard @cosmjs dependency into the SDK's public surface.
 * The casts below (through `unknown`) bridge the two; whatever the integrator's
 * wallet returns is proxied verbatim by cosmiframe.
 */
type ListenOptions = Parameters<typeof Cosmiframe.listen>[0];

/**
 * Cosmiframe's parent metadata shape (`{ name?, imageUrl? }`). cosmiframe
 * captures the `metadata` option ONCE at listen() time and answers the child's
 * `getMetadata` probe with `metadata || null` (it never re-invokes a getter and
 * never re-reads the option). To surface a metadata value that is supplied
 * lazily by a later `setWallet`, the listener is given a STABLE plain object
 * whose fields are mutated in place. cosmiframe keeps the same object reference,
 * so the child reads whatever fields are current at probe time. A plain object
 * (never a function) is required because the answer is structured-cloned across
 * postMessage; a function would throw DataCloneError and crash the responder.
 */
type CosmosMetadataView = { name?: string; imageUrl?: string };

/**
 * Mutable holder for the current cosmos handle. The cosmiframe listener is
 * installed once against this holder; `setWallet` / `clearWallet` swap the held
 * handle so the same listener proxies to whatever wallet is current (or rejects
 * cleanly when none is set). `metadataView` is the stable object cosmiframe
 * captured for `getMetadata`; setWallet / clearWallet sync its fields.
 */
interface CosmosHandleHolder {
  handle: WalletCosmosHandle | null;
  readonly metadataView: CosmosMetadataView;
}

/**
 * Overwrite the stable metadata object's fields in place to match the handle's
 * metadata (or empty when no handle / no metadata). Mutates the SAME object
 * cosmiframe captured at listen() time so the lazily-supplied value is surfaced
 * to the child without re-listening.
 */
function syncCosmosMetadata(holder: CosmosHandleHolder): void {
  const view = holder.metadataView;
  for (const key of Object.keys(view)) {
    delete (view as Record<string, unknown>)[key];
  }
  const md = holder.handle?.metadata;
  if (md) {
    if (md.name !== undefined) view.name = md.name;
    if (md.imageUrl !== undefined) view.imageUrl = md.imageUrl;
  }
}

/**
 * Error surfaced over cosmiframe when a proxied wallet method (target call or
 * signer fetch) arrives before any cosmos handle has been set. Cosmiframe
 * relays the throw to the child as a structured `{ type: 'error' }` response,
 * so the child sees a clean rejection rather than the parent listener crashing.
 */
const NO_COSMOS_HANDLE_MESSAGE =
  'No parent Cosmos wallet is connected yet. Connect a wallet on the host page (call setWallet) before requesting accounts or signatures.';

/**
 * Install the cosmiframe parent listener ONCE, at controller-creation time, in
 * parent mode. The listener answers the child's internal handshake probes
 * (`isCosmiframe` -> true, `getMetadata` -> the held handle's metadata or null)
 * regardless of whether a wallet handle is present, so the embedded widget's
 * mount-time `isReady()` 500ms probe is answered immediately and cosmos-kit does
 * not throw "Failed to detect Cosmiframe parent of allowed origin."
 *
 * The signer target is read lazily from `holder` on every proxied call:
 * - Non-signer methods (getKey / enable / connect / getAccount / ...) dispatch
 *   to the held handle's `target` via a proxy that reports every method as
 *   present and callable, then rejects cleanly if no handle is set.
 * - Signer getters return the held handle's offline signer for the chain id, or
 *   reject cleanly if no handle is set.
 *
 * The child origin allowlist stays `[widgetOrigin]` (never '*', never a RegExp
 * wildcard, never the cosmiframe UNSAFE sentinel).
 */
function installCosmosListener(
  iframe: HTMLIFrameElement,
  widgetOrigin: string,
  holder: CosmosHandleHolder
): () => void {
  // A target proxy that, for any string property access, returns a function
  // that dispatches to the currently-held handle's target. cosmiframe gates a
  // target method call on `s in target && typeof target[s] === 'function'`
  // (client.js listen: `if (!(s in r) || typeof r[s] !== 'function') throw`), so
  // the proxy must report BOTH that every string method exists (has trap) AND
  // that it is callable (get trap returns a function). The actual presence /
  // type check against the real wallet happens inside the dispatcher, which
  // rejects cleanly when no handle is set or the held wallet lacks the method.
  const targetProxy = new Proxy(
    {} as Record<string, unknown>,
    {
      has: (_t, prop) => typeof prop === 'string',
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]): Promise<unknown> => {
          const handle = holder.handle;
          if (!handle) {
            return Promise.reject(new Error(NO_COSMOS_HANDLE_MESSAGE));
          }
          const fn = handle.target[prop];
          if (typeof fn !== 'function') {
            return Promise.reject(
              new Error(`No method '${prop}' on the connected Cosmos wallet.`)
            );
          }
          return Promise.resolve(
            (fn as (...a: unknown[]) => unknown).apply(handle.target, args)
          );
        };
      },
    }
  ) as Record<string, unknown>;

  const getOfflineSignerDirect = (chainId: string): unknown => {
    const handle = holder.handle;
    if (!handle) {
      throw new Error(NO_COSMOS_HANDLE_MESSAGE);
    }
    return handle.getOfflineSignerDirect(chainId);
  };
  const getOfflineSignerAmino = (chainId: string): unknown => {
    const handle = holder.handle;
    if (!handle) {
      throw new Error(NO_COSMOS_HANDLE_MESSAGE);
    }
    return handle.getOfflineSignerAmino(chainId);
  };

  // The cosmiframe child (inside the iframe) is the only origin allowed to
  // talk to this listener. Never '*', never a RegExp wildcard.
  const unlisten = Cosmiframe.listen({
    iframe,
    target: targetProxy,
    getOfflineSignerDirect:
      getOfflineSignerDirect as unknown as ListenOptions['getOfflineSignerDirect'],
    getOfflineSignerAmino:
      getOfflineSignerAmino as unknown as ListenOptions['getOfflineSignerAmino'],
    origins: [widgetOrigin],
    // A STABLE plain object (never a function). cosmiframe captures this
    // reference once and answers `getMetadata` with it directly (`metadata ||
    // null`), structured-cloning the result. setWallet / clearWallet mutate this
    // object's fields in place (syncCosmosMetadata) so a handle supplied after
    // the listener is installed still surfaces its parent metadata to the child.
    metadata: holder.metadataView,
  });
  return () => {
    try {
      unlisten();
    } catch {
      /* cosmiframe unlisten is best-effort */
    }
  };
}

/* ------------------------------------------------------------------------- */
/* EVM channel (custom envelope relay)                                        */
/* ------------------------------------------------------------------------- */

/**
 * EIP-1193 / JSON-RPC error code surfaced when the provider rejects a request
 * without a numeric code of its own. -32603 is the JSON-RPC "internal error"
 * code, the conventional fallback for an unstructured provider throw.
 */
const INTERNAL_ERROR_CODE = -32603;

function wireEvmBridge(
  iframe: HTMLIFrameElement,
  widgetOrigin: string,
  evm: WalletEvmHandle,
  warn?: (message: string) => void
): () => void {
  const provider = evm.provider;

  const post = (message: EvmResponseMessage | EvmEventMessage): void => {
    const target = iframe.contentWindow;
    if (!target) return;
    try {
      // Always target the iframe origin explicitly. Never '*'.
      target.postMessage(message, widgetOrigin);
    } catch {
      // postMessage can throw if the iframe is mid-teardown / detached. The
      // relay response/event is best-effort; never let it bubble up and crash
      // the provider.request() chain or a forwarded provider event handler.
    }
  };

  const onMessage = (event: MessageEvent): void => {
    // Transport-layer checks first: origin AND source must both match before
    // the payload is even shape-validated. A message from any other origin or
    // window is silently dropped.
    if (event.origin !== widgetOrigin) return;
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;
    // Shape guard. Drops anything not carrying our exact namespace + a valid
    // request envelope (wrong ns, missing fields, malformed types).
    if (!isEvmRequestMessage(data)) return;

    const { id, method, params } = data;

    void provider
      .request({ method, ...(params !== undefined ? { params } : {}) })
      .then((result: unknown) => {
        post({ ns: EVM_BRIDGE_NS, kind: 'response', id, result });
      })
      .catch((err: unknown) => {
        post({
          ns: EVM_BRIDGE_NS,
          kind: 'response',
          id,
          error: normalizeProviderError(err),
        });
      });
  };

  window.addEventListener('message', onMessage);

  // Forward provider push events to the iframe origin. Only wired when the
  // provider exposes the EIP-1193 event surface.
  const eventTeardowns: Array<() => void> = [];
  if (typeof provider.on === 'function') {
    const onAccountsChanged = (...args: unknown[]): void => {
      const accounts = Array.isArray(args[0])
        ? (args[0] as unknown[]).filter(
            (a): a is string => typeof a === 'string'
          )
        : [];
      post({
        ns: EVM_BRIDGE_NS,
        kind: 'event',
        event: 'accountsChanged',
        accounts,
      });
    };
    const onChainChanged = (...args: unknown[]): void => {
      const chainId = typeof args[0] === 'string' ? args[0] : String(args[0]);
      post({ ns: EVM_BRIDGE_NS, kind: 'event', event: 'chainChanged', chainId });
    };
    const onDisconnect = (...args: unknown[]): void => {
      // EIP-1193 fires disconnect with a ProviderRpcError. Forward it (don't
      // silently drop args[0]) so the iframe-side consumer can surface the
      // reason; it remains free to ignore it. Absent when no error was provided.
      const hasError = args.length > 0 && args[0] !== undefined && args[0] !== null;
      post({
        ns: EVM_BRIDGE_NS,
        kind: 'event',
        event: 'disconnect',
        ...(hasError ? { error: normalizeProviderError(args[0]) } : {}),
      });
    };

    subscribe(provider, 'accountsChanged', onAccountsChanged, eventTeardowns, warn);
    subscribe(provider, 'chainChanged', onChainChanged, eventTeardowns, warn);
    subscribe(provider, 'disconnect', onDisconnect, eventTeardowns, warn);
  }

  return () => {
    window.removeEventListener('message', onMessage);
    for (const fn of eventTeardowns) {
      try {
        fn();
      } catch {
        /* removeListener is best-effort */
      }
    }
  };
}

/**
 * Subscribe `listener` to `event` on the provider and push a matching
 * unsubscribe (using removeListener when available) onto `teardowns`.
 */
function subscribe(
  provider: WalletEvmHandle['provider'],
  event: string,
  listener: (...args: unknown[]) => void,
  teardowns: Array<() => void>,
  warn?: (message: string) => void
): void {
  try {
    provider.on?.(event, listener);
    teardowns.push(() => provider.removeListener?.(event, listener));
  } catch (err) {
    if (warn) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`Atom Circuit embed: failed to subscribe to provider ${event}: ${message}`);
    }
  }
}

/**
 * Coerce an arbitrary provider rejection into the `{ code, message }` error
 * shape the wire contract requires. Preserves a numeric `code` when the
 * provider supplies one (EIP-1193 ProviderRpcError), otherwise falls back to
 * the JSON-RPC internal-error code so an unknown-method or any other throw
 * surfaces as a structured error response rather than a crash.
 */
function normalizeProviderError(err: unknown): { code: number; message: string } {
  let code = INTERNAL_ERROR_CODE;
  let message = 'Provider request failed';
  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    // Only accept an integer code. A non-integer / NaN / Infinity code is
    // dropped in favour of the internal-error fallback so a malformed provider
    // error cannot forward a nonsensical code on the wire.
    if (Number.isInteger(record['code'])) {
      code = record['code'] as number;
    }
    if (typeof record['message'] === 'string' && record['message'].length > 0) {
      message = record['message'];
    }
  } else if (typeof err === 'string' && err.length > 0) {
    message = err;
  }
  return { code, message };
}
