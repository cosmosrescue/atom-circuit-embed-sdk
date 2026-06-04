/**
 * Thin convenience helpers that adapt the common wallet stacks into the
 * explicit {@link WalletCosmosHandle} / {@link WalletEvmHandle} objects the
 * bridge consumes. The explicit handle objects remain the underlying contract;
 * these helpers just save the integrator a few lines of boilerplate for the
 * two most common stacks (cosmos-kit and wagmi).
 *
 * They are intentionally dependency-free and structurally typed: the SDK does
 * not take a hard dependency on @cosmos-kit or wagmi. An integrator on a
 * different stack constructs the handle objects by hand.
 */

import type {
  Eip1193ProviderLike,
  OfflineSignerLike,
  WalletCosmosHandle,
  WalletEvmHandle,
} from './protocol.js';

/**
 * The subset of a cosmos-kit wallet client the bridge needs. A connected
 * cosmos-kit `walletClient` (e.g. from `useWallet().client` or a ChainWallet's
 * `client`) exposes `getOfflineSignerDirect` / `getOfflineSignerAmino`. Some
 * clients expose only a unified `getOfflineSigner`; this helper accepts either.
 */
export interface CosmosKitClientLike {
  getOfflineSignerDirect?: (
    chainId: string
  ) => OfflineSignerLike | Promise<OfflineSignerLike>;
  getOfflineSignerAmino?: (
    chainId: string
  ) => OfflineSignerLike | Promise<OfflineSignerLike>;
  getOfflineSigner?: (
    chainId: string,
    ...rest: unknown[]
  ) => OfflineSignerLike | Promise<OfflineSignerLike>;
  [key: string]: unknown;
}

/**
 * Optional behaviour knobs for {@link fromCosmosKit}. Shaped as an options
 * object (mirroring {@link FromInjectedCosmosWalletOptions}) so both helpers
 * share one consistent second-argument convention.
 */
export interface FromCosmosKitOptions {
  /** Optional parent metadata (name + image) the iframe may display. */
  metadata?: { name?: string; imageUrl?: string };
}

/**
 * Build a {@link WalletCosmosHandle} from a connected cosmos-kit wallet client.
 *
 * - `target` is the client (with synthesized `connect` / `enable` shims when the
 *   client lacks them - see below): cosmiframe proxies non-signer methods
 *   (getKey, enable, getAccount, etc.) to it generically.
 * - The signer getters prefer the client's dedicated direct/amino getters and
 *   fall back to the unified `getOfflineSigner(chainId, signerType)` form.
 *
 * WHY THE connect/enable SHIM (spec 5.6, the Cosmostation gap): cosmos-kit's
 * iframe-side `CosmiframeClient` proxies `connect` and `enable` to the parent
 * `target` during connect (@cosmos-kit/core cjs/cosmiframe/extension/client.js:
 * `connect(...p) => cosmiframe.p.connect(...p)`,
 * `enable(...p) => cosmiframe.p.enable(...p)`). The @dao-dao/cosmiframe parent
 * listener throws `No method 'connect' on target` for any proxied method the
 * target does not expose as a function (dist/index.js `Cosmiframe.listen`).
 * cosmos-kit's `CosmostationClient` (@cosmos-kit/cosmostation-extension
 * cjs/extension/client.js) exposes getAccount / getSimpleAccount / sign* /
 * getOfflineSigner* but has NO `connect` and NO `enable`, so a raw Cosmostation
 * cosmos-kit client breaks the bridge the moment the iframe connects. Keplr's
 * cosmos-kit `KeplrClient` HAS `enable` (and connect is derived by cosmos-kit),
 * so we must NOT clobber a client that already exposes them. This helper
 * therefore SYNTHESIZES minimal resolving shims only for whichever of
 * connect/enable the client lacks; the real connection already happened on the
 * parent page, so the shims simply satisfy the proxied call.
 *
 * Throws if the client exposes neither a typed getter nor `getOfflineSigner`,
 * because a handle that cannot produce a signer would silently fail at sign
 * time rather than at wiring time.
 */
export function fromCosmosKit(
  client: CosmosKitClientLike,
  options?: FromCosmosKitOptions
): WalletCosmosHandle {
  if (!client || typeof client !== 'object') {
    throw new TypeError('fromCosmosKit: a connected wallet client is required');
  }

  const direct = client.getOfflineSignerDirect;
  const amino = client.getOfflineSignerAmino;
  const unified = client.getOfflineSigner;

  if (typeof direct !== 'function' && typeof unified !== 'function') {
    throw new TypeError(
      'fromCosmosKit: client exposes neither getOfflineSignerDirect nor getOfflineSigner'
    );
  }

  const getOfflineSignerDirect = (
    chainId: string
  ): OfflineSignerLike | Promise<OfflineSignerLike> =>
    typeof direct === 'function'
      ? direct.call(client, chainId)
      : (unified as NonNullable<CosmosKitClientLike['getOfflineSigner']>).call(
          client,
          chainId,
          'direct'
        );

  const getOfflineSignerAmino = (
    chainId: string
  ): OfflineSignerLike | Promise<OfflineSignerLike> =>
    typeof amino === 'function'
      ? amino.call(client, chainId)
      : (unified as NonNullable<CosmosKitClientLike['getOfflineSigner']>).call(
          client,
          chainId,
          'amino'
        );

  // The cosmiframe parent listener invokes target[method](...params) for the
  // proxied connect/enable. We build a target that delegates EVERY method to the
  // client (so getAccount / getSimpleAccount / sign* / getKey / disconnect /
  // etc. forward verbatim), then layer synthesized connect/enable ONLY where the
  // client lacks them. A client that already has connect/enable (Keplr) keeps
  // its own - we never overwrite a present method.
  const hasConnect = typeof client['connect'] === 'function';
  const hasEnable = typeof client['enable'] === 'function';

  // Resolving enable shim: forward to client.enable if it somehow exists at call
  // time, otherwise just resolve. Used both as the synthesized `enable` and as
  // the body of the synthesized `connect` (cosmos-kit's connect ultimately means
  // "make the requested chains available", already true on the parent).
  const synthEnable = async (chainIds?: string | string[]): Promise<void> => {
    const fn = client['enable'];
    if (typeof fn === 'function') {
      await (fn as (ids?: string | string[]) => unknown).call(client, chainIds);
    }
  };
  const synthConnect = async (chainIds?: string | string[]): Promise<void> => {
    // The wallet is already connected on the parent; connect just ensures the
    // requested chains are enabled (when the client can) and resolves.
    if (chainIds !== undefined) {
      await synthEnable(chainIds);
    }
  };

  // Build the proxied target. We start from the client so unknown methods
  // forward through, but the cosmiframe listener reads named methods off the
  // target object directly (`s in r && typeof r[s] === 'function'`), so we must
  // present connect/enable as own properties when synthesizing. Use a Proxy so
  // the client's real methods (bound to the client) are reachable and only the
  // missing connect/enable are overlaid.
  const overlay: Record<string, unknown> = {};
  if (!hasConnect) overlay['connect'] = synthConnect;
  if (!hasEnable) overlay['enable'] = synthEnable;

  const target: Record<string, unknown> =
    Object.keys(overlay).length === 0
      ? (client as Record<string, unknown>)
      : new Proxy(client as Record<string, unknown>, {
          get(obj, prop, receiver) {
            if (typeof prop === 'string' && prop in overlay) {
              return overlay[prop];
            }
            const value = Reflect.get(obj, prop, receiver);
            // Bind functions to the underlying client so `this` is correct when
            // the cosmiframe listener invokes target[method](...).
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(obj)
              : value;
          },
          has(obj, prop) {
            return (
              (typeof prop === 'string' && prop in overlay) ||
              Reflect.has(obj, prop)
            );
          },
        });

  return {
    target,
    getOfflineSignerDirect,
    getOfflineSignerAmino,
    ...(options?.metadata ? { metadata: options.metadata } : {}),
  };
}

/**
 * The Keplr `Key` shape returned by `getKey(chainId)`. Cosmostation (via
 * `window.cosmostation.providers.keplr`) and other Keplr-API-compatible
 * injected wallets return the same fields. Only the fields cosmos-kit's
 * KeplrClient reads to derive an account are typed here; any extra fields the
 * wallet returns are ignored.
 */
export interface KeplrKeyLike {
  readonly name: string;
  readonly algo: string;
  readonly pubKey: Uint8Array;
  readonly bech32Address: string;
  readonly isNanoLedger: boolean;
  readonly [key: string]: unknown;
}

/**
 * The RAW injected-wallet provider surface {@link fromInjectedCosmosWallet}
 * wraps. This is the shape of `window.keplr`,
 * `window.cosmostation.providers.keplr`, and any other Keplr-API-compatible
 * injected wallet. It has `enable` / `getKey` / `sign*` / the offline-signer
 * factories, but crucially NO `connect`, `getAccount`, or `getSimpleAccount` -
 * which is exactly why a raw provider cannot be used as a Cosmiframe `target`
 * (see {@link fromInjectedCosmosWallet}).
 */
export interface KeplrInjectedProviderLike {
  enable(chainIds: string | string[]): Promise<void>;
  getKey(chainId: string): Promise<KeplrKeyLike>;
  getOfflineSigner(
    chainId: string,
    ...rest: unknown[]
  ): OfflineSignerLike | Promise<OfflineSignerLike>;
  getOfflineSignerOnlyAmino(
    chainId: string,
    ...rest: unknown[]
  ): OfflineSignerLike | Promise<OfflineSignerLike>;
  signAmino?(...args: unknown[]): Promise<unknown>;
  signDirect?(...args: unknown[]): Promise<unknown>;
  signArbitrary?(...args: unknown[]): Promise<unknown>;
  suggestToken?(...args: unknown[]): Promise<unknown>;
  sendTx?(...args: unknown[]): Promise<unknown>;
  [key: string]: unknown;
}

/**
 * The account shape cosmos-kit derives from a Keplr `Key`. Mirrors
 * `@cosmos-kit/keplr-extension`'s `KeplrClient.getAccount` return
 * (cjs/extension/client.js): `{ username, address, algo, pubkey, isNanoLedger }`.
 */
export interface DerivedCosmosAccount {
  readonly username: string;
  readonly address: string;
  readonly algo: string;
  readonly pubkey: Uint8Array;
  readonly isNanoLedger: boolean;
}

/**
 * The simple-account shape cosmos-kit derives. Mirrors
 * `@cosmos-kit/keplr-extension`'s `KeplrClient.getSimpleAccount`:
 * `{ namespace: 'cosmos', chainId, address, username }`.
 */
export interface DerivedCosmosSimpleAccount {
  readonly namespace: 'cosmos';
  readonly chainId: string;
  readonly address: string;
  readonly username: string;
}

/** Optional behaviour knobs for {@link fromInjectedCosmosWallet}. */
export interface FromInjectedCosmosWalletOptions {
  /** Optional parent metadata (name + image) the iframe may display. */
  metadata?: { name?: string; imageUrl?: string };
}

/**
 * @deprecated Renamed to {@link FromInjectedCosmosWalletOptions}. This alias is
 * retained for back-compat and will be removed in a future major.
 */
export type FromKeplrOptions = FromInjectedCosmosWalletOptions;

/**
 * Build a {@link WalletCosmosHandle} from a RAW injected Keplr-compatible
 * provider. Works for ANY wallet that exposes the Keplr injected API:
 * `window.keplr`, Cosmostation via `window.cosmostation.providers.keplr`, and
 * any other Keplr-API-compatible injected wallet.
 *
 * WHY THIS EXISTS (the bug that bit us, spec Appendix A.6): cosmos-kit's
 * iframe-side `CosmiframeClient` proxies `connect`, `enable`, `getKey`,
 * `getAccount`, `getSimpleAccount`, `sign*`, `suggestToken`, `sendTx`, etc. to
 * the parent `target` during connect (see @cosmos-kit/core
 * cjs/cosmiframe/extension/client.js). The cosmiframe parent listener throws
 * `No method '<m>' on target` for any proxied method the target does not expose
 * as a function (see @dao-dao/cosmiframe dist/index.js `Cosmiframe.listen`).
 * A RAW injected provider has `enable` / `getKey` / `sign*` but NOT `connect`,
 * `getAccount`, or `getSimpleAccount` (cosmos-kit DERIVES those from `getKey` -
 * it never calls them on the injected provider). Passing the raw provider as
 * the target therefore makes the parent throw `No method 'connect' on target`
 * the moment the iframe tries to connect, and adoption silently falls back to
 * the picker. This helper wraps the raw provider into a VALID target by adding
 * `connect` (a no-op resolve, since the wallet is already connected on the
 * parent) and deriving `getAccount` / `getSimpleAccount` from `getKey` exactly
 * as `@cosmos-kit/keplr-extension`'s `KeplrClient` does.
 *
 * Contrast with {@link fromCosmosKit}: that helper is for an ACTUAL cosmos-kit
 * wallet client. `fromInjectedCosmosWallet` is for a raw INJECTED provider that
 * lacks connect / getAccount / getSimpleAccount.
 *
 * @param provider A raw Keplr-compatible injected provider (window.keplr,
 *   window.cosmostation.providers.keplr, etc.).
 * @param options Optional metadata.
 */
export function fromInjectedCosmosWallet(
  provider: KeplrInjectedProviderLike,
  options?: FromInjectedCosmosWalletOptions
): WalletCosmosHandle {
  if (
    !provider ||
    typeof provider !== 'object' ||
    typeof provider.getKey !== 'function' ||
    typeof provider.enable !== 'function' ||
    typeof provider.getOfflineSigner !== 'function' ||
    typeof provider.getOfflineSignerOnlyAmino !== 'function'
  ) {
    throw new TypeError(
      'fromInjectedCosmosWallet: a raw injected Keplr-compatible provider with ' +
        'enable, getKey, getOfflineSigner and getOfflineSignerOnlyAmino is required'
    );
  }

  // getAccount(chainId): derive from getKey exactly as KeplrClient.getAccount.
  // Field names mirror @cosmos-kit/keplr-extension cjs/extension/client.js:
  //   { username: key.name, address: key.bech32Address, algo: key.algo,
  //     pubkey: key.pubKey, isNanoLedger: key.isNanoLedger }
  const getAccount = async (chainId: string): Promise<DerivedCosmosAccount> => {
    const key = await provider.getKey(chainId);
    return {
      username: key.name,
      address: key.bech32Address,
      algo: key.algo,
      pubkey: key.pubKey,
      isNanoLedger: key.isNanoLedger,
    };
  };

  // getSimpleAccount(chainId): derive from getAccount exactly as
  // KeplrClient.getSimpleAccount:
  //   { namespace: 'cosmos', chainId, address, username }
  const getSimpleAccount = async (
    chainId: string
  ): Promise<DerivedCosmosSimpleAccount> => {
    const { address, username } = await getAccount(chainId);
    return { namespace: 'cosmos', chainId, address, username };
  };

  // The cosmiframe parent listener invokes target[method](...params) for every
  // non-signer method the iframe-side client proxies. We expose:
  //  - connect: cosmos-kit's CosmiframeClient.connect proxies to target.connect.
  //    The wallet is already enabled on the parent, so connect just enables the
  //    requested chains (cosmos-kit passes chainIds) and resolves. There is no
  //    raw-provider `connect`, so we synthesize one.
  //  - getKey / enable / sign* / suggestToken / sendTx / getOfflineSigner*:
  //    forwarded verbatim to the raw provider (it exposes these natively).
  //  - getAccount / getSimpleAccount: DERIVED above (the raw provider lacks them).
  const connect = async (chainIds?: string | string[]): Promise<void> => {
    if (chainIds !== undefined) {
      await provider.enable(chainIds);
    }
  };

  // addChain: cosmos-kit's recovery path (when a source chain is not yet added
  // to the wallet) proxies `client.addChain(chainRecord)` through the
  // CosmiframeClient, which the parent listener invokes as target.addChain(...).
  // A raw injected provider has no usable addChain here (this helper
  // deliberately avoids a chain-registry dependency to convert a chainRecord),
  // so without this method the cosmiframe listener throws the cryptic
  // `No method 'addChain' on target`. We instead expose an addChain that throws
  // a CLEAR, actionable error (relayed back over cosmiframe as the error
  // message) so the integrator knows exactly what to do. Async so the rejection
  // surfaces as a relayed error rather than a synchronous throw in the listener.
  const addChain = async (chainArg?: unknown): Promise<never> => {
    const id =
      chainArg &&
      typeof chainArg === 'object' &&
      typeof (chainArg as { chainId?: unknown }).chainId === 'string'
        ? (chainArg as { chainId: string }).chainId
        : 'the requested chain';
    throw new Error(
      `fromInjectedCosmosWallet: the wallet does not have ${id} added. ` +
        'Add it in your wallet first, or use fromCosmosKit which can add chains.'
    );
  };

  // Bind every forwarded method to the raw provider so `this` is correct when
  // the wallet implementation relies on it. Only forward functions that exist.
  const bind = <T extends (...args: never[]) => unknown>(
    name: string
  ): T | undefined =>
    typeof provider[name] === 'function'
      ? ((provider[name] as T).bind(provider) as T)
      : undefined;

  const target: Record<string, unknown> = {
    connect,
    addChain,
    enable: bind('enable'),
    getKey: bind('getKey'),
    getAccount,
    getSimpleAccount,
    getOfflineSigner: bind('getOfflineSigner'),
    getOfflineSignerOnlyAmino: bind('getOfflineSignerOnlyAmino'),
    getOfflineSignerAuto: bind('getOfflineSignerAuto'),
    signAmino: bind('signAmino'),
    signDirect: bind('signDirect'),
    signArbitrary: bind('signArbitrary'),
    suggestToken: bind('suggestToken'),
    sendTx: bind('sendTx'),
    experimentalSuggestChain: bind('experimentalSuggestChain'),
  };
  // Drop any undefined entries so the target only advertises real methods (the
  // cosmiframe listener checks `typeof target[m] === 'function'`).
  for (const k of Object.keys(target)) {
    if (target[k] === undefined) delete target[k];
  }

  return {
    target,
    getOfflineSignerDirect: (chainId: string) =>
      provider.getOfflineSigner(chainId),
    getOfflineSignerAmino: (chainId: string) =>
      provider.getOfflineSignerOnlyAmino(chainId),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
  };
}

/**
 * @deprecated Renamed to {@link fromInjectedCosmosWallet} (it accepts ANY
 * Keplr-compatible injected provider, not only Keplr - e.g. Cosmostation via
 * `window.cosmostation.providers.keplr`). This back-compat alias is identical
 * and will be removed in a future major. Prefer `fromInjectedCosmosWallet`.
 */
export const fromKeplr = fromInjectedCosmosWallet;

/**
 * Build a {@link WalletEvmHandle} from a resolved EIP-1193 provider.
 *
 * The bridge needs a synchronous provider reference (it relays `request(...)`
 * and subscribes to events at wire time), so this helper takes the
 * already-resolved provider. With wagmi, resolve it first via
 * `await config.connectors[i].getProvider()` (or `getAccount(config)
 * .connector.getProvider()`), then pass it here. A `{ request, on?,
 * removeListener? }` object (window.ethereum, a viem custom transport's
 * provider, etc.) satisfies the contract directly.
 */
export function fromWagmi(provider: Eip1193ProviderLike): WalletEvmHandle {
  // Some providers are callable objects (typeof === 'function') that still carry
  // a `request` method, so accept both 'object' and 'function' as long as
  // `request` is a function.
  const isObjectOrFunction =
    !!provider &&
    (typeof provider === 'object' || typeof provider === 'function');
  if (!isObjectOrFunction || typeof provider.request !== 'function') {
    throw new TypeError(
      'fromWagmi: an EIP-1193 provider with a request() method is required; ' +
        'resolve it via connector.getProvider() before calling'
    );
  }
  return { provider };
}
