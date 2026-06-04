/**
 * Convenience-helper tests. The helpers adapt the two common stacks into the
 * explicit WalletCosmosHandle / WalletEvmHandle objects; the explicit objects
 * remain the underlying contract.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  fromCosmosKit,
  fromInjectedCosmosWallet,
  fromKeplr,
  fromWagmi,
} from '../src/helpers.js';
import type { KeplrInjectedProviderLike } from '../src/helpers.js';
import type { Eip1193ProviderLike } from '../src/protocol.js';

describe('fromCosmosKit()', () => {
  it('uses the client typed direct/amino getters when present and the target delegates to the client', async () => {
    const direct = vi.fn().mockReturnValue({ signDirect: vi.fn() });
    const amino = vi.fn().mockReturnValue({ signAmino: vi.fn() });
    const getKey = vi.fn().mockResolvedValue({ name: 'k' });
    const client = {
      getOfflineSignerDirect: direct,
      getOfflineSignerAmino: amino,
      getKey,
    };
    // This client lacks connect/enable, so the target is a delegating Proxy
    // (the shim overlay) rather than the client identity. Existing client
    // methods still forward through.
    const handle = fromCosmosKit(client, { metadata: { name: 'Keplr' } });
    expect(handle.metadata).toEqual({ name: 'Keplr' });
    expect(typeof handle.target['connect']).toBe('function');
    expect(typeof handle.target['enable']).toBe('function');
    await (handle.target['getKey'] as (c: string) => Promise<unknown>)('x');
    expect(getKey).toHaveBeenCalledWith('x');

    handle.getOfflineSignerDirect('cosmoshub-4');
    handle.getOfflineSignerAmino('cosmoshub-4');
    expect(direct).toHaveBeenCalledWith('cosmoshub-4');
    expect(amino).toHaveBeenCalledWith('cosmoshub-4');
  });

  it('falls back to the unified getOfflineSigner(chainId, signerType) form', () => {
    const unified = vi.fn().mockReturnValue({});
    const client = { getOfflineSigner: unified };
    const handle = fromCosmosKit(client);
    handle.getOfflineSignerDirect('cosmoshub-4');
    handle.getOfflineSignerAmino('cosmoshub-4');
    expect(unified).toHaveBeenNthCalledWith(1, 'cosmoshub-4', 'direct');
    expect(unified).toHaveBeenNthCalledWith(2, 'cosmoshub-4', 'amino');
  });

  it('omits metadata when not supplied', () => {
    const handle = fromCosmosKit({ getOfflineSigner: vi.fn() });
    expect('metadata' in handle).toBe(false);
  });

  it('reads metadata from the options object (aligned with fromInjectedCosmosWallet shape)', () => {
    const handle = fromCosmosKit(
      { getOfflineSigner: vi.fn() },
      { metadata: { name: 'My App', imageUrl: 'https://example.com/i.png' } }
    );
    expect(handle.metadata).toEqual({
      name: 'My App',
      imageUrl: 'https://example.com/i.png',
    });
  });

  it('omits metadata when the options object has no metadata key', () => {
    const handle = fromCosmosKit({ getOfflineSigner: vi.fn() }, {});
    expect('metadata' in handle).toBe(false);
  });

  it('throws when the client exposes no usable signer getter', () => {
    expect(() => fromCosmosKit({ getKey: vi.fn() })).toThrow(/getOfflineSigner/);
  });

  it('throws when given a non-object', () => {
    expect(() => fromCosmosKit(null as unknown as Record<string, unknown>)).toThrow(
      /connected wallet client/
    );
  });

  /* ------------------- connect/enable shim (spec 5.6 gap) ------------------ */

  it('REGRESSION: a Cosmostation-shaped cosmos-kit client lacks connect/enable; fromCosmosKit synthesizes callable, resolving ones', async () => {
    // @cosmos-kit/cosmostation-extension CostmostationClient: has
    // getAccount/getSimpleAccount/sign*/getOfflineSigner* but NO connect, NO
    // enable. The cosmiframe parent listener would throw
    // "No method 'connect' on target" for the proxied connect/enable.
    const getAccount = vi.fn().mockResolvedValue({
      address: 'cosmos1cosmostation',
      username: 'cosmostation acct',
    });
    const getSimpleAccount = vi.fn().mockResolvedValue({
      namespace: 'cosmos',
      chainId: 'cosmoshub-4',
      address: 'cosmos1cosmostation',
      username: 'cosmostation acct',
    });
    const signAmino = vi.fn();
    const client = {
      getAccount,
      getSimpleAccount,
      getOfflineSignerDirect: vi.fn().mockReturnValue({ signDirect: vi.fn() }),
      getOfflineSignerAmino: vi.fn().mockReturnValue({ signAmino: vi.fn() }),
      signAmino,
      // crucially: NO connect, NO enable.
    };
    expect(typeof (client as Record<string, unknown>)['connect']).not.toBe(
      'function'
    );
    expect(typeof (client as Record<string, unknown>)['enable']).not.toBe(
      'function'
    );

    const handle = fromCosmosKit(client);
    const t = handle.target;
    // Synthesized: callable connect + enable.
    expect(typeof t['connect']).toBe('function');
    expect(typeof t['enable']).toBe('function');
    // They resolve (the real connection already happened on the parent).
    await expect(
      (t['connect'] as () => Promise<void>)()
    ).resolves.toBeUndefined();
    await expect(
      (t['enable'] as (ids?: string | string[]) => Promise<void>)('cosmoshub-4')
    ).resolves.toBeUndefined();

    // Existing methods still forward to the client (Proxy delegation).
    await (t['getAccount'] as (c: string) => Promise<unknown>)('cosmoshub-4');
    expect(getAccount).toHaveBeenCalledWith('cosmoshub-4');
    await (t['getSimpleAccount'] as (c: string) => Promise<unknown>)(
      'cosmoshub-4'
    );
    expect(getSimpleAccount).toHaveBeenCalledWith('cosmoshub-4');
    expect(typeof t['signAmino']).toBe('function');
  });

  it('REGRESSION: a Keplr-shaped client that already has connect/enable keeps its OWN (not clobbered)', async () => {
    const ownConnect = vi.fn().mockResolvedValue('keplr-connect');
    const ownEnable = vi.fn().mockResolvedValue('keplr-enable');
    const client = {
      connect: ownConnect,
      enable: ownEnable,
      getAccount: vi.fn(),
      getSimpleAccount: vi.fn(),
      getOfflineSignerDirect: vi.fn().mockReturnValue({}),
      getOfflineSignerAmino: vi.fn().mockReturnValue({}),
    };
    const handle = fromCosmosKit(client);
    // When no overlay is needed, the target is the client itself (no Proxy).
    expect(handle.target).toBe(client);
    // The client's own connect/enable are invoked, not replaced by a shim.
    await (handle.target['connect'] as () => Promise<unknown>)();
    await (handle.target['enable'] as (ids: string) => Promise<unknown>)(
      'cosmoshub-4'
    );
    expect(ownConnect).toHaveBeenCalledTimes(1);
    expect(ownEnable).toHaveBeenCalledWith('cosmoshub-4');
  });

  it('synthesizes ONLY the missing one when a client has enable but not connect (and forwards to the real enable)', async () => {
    const ownEnable = vi.fn().mockResolvedValue(undefined);
    const client = {
      enable: ownEnable, // present
      // connect missing
      getAccount: vi.fn(),
      getSimpleAccount: vi.fn(),
      getOfflineSigner: vi.fn().mockReturnValue({}),
    };
    const handle = fromCosmosKit(client);
    expect(typeof handle.target['connect']).toBe('function');
    expect(typeof handle.target['enable']).toBe('function');
    // The synthesized connect forwards chain enabling to the real enable.
    await (handle.target['connect'] as (ids: string) => Promise<void>)(
      'cosmoshub-4'
    );
    expect(ownEnable).toHaveBeenCalledWith('cosmoshub-4');
    // The kept enable is the client's own (forwarded).
    await (handle.target['enable'] as (ids: string) => Promise<void>)('osmosis-1');
    expect(ownEnable).toHaveBeenCalledWith('osmosis-1');
  });
});

describe('fromKeplr()', () => {
  /**
   * A raw injected Keplr-compatible provider. This is exactly the shape of
   * window.keplr: it has enable / getKey / sign* / the offline-signer
   * factories, but NO connect / getAccount / getSimpleAccount. cosmos-kit's
   * iframe-side CosmiframeClient proxies connect / getSimpleAccount /
   * getAccount to the parent target during connect; a raw provider therefore
   * makes the parent throw `No method 'connect' on target` and adoption
   * silently fails to the picker. fromKeplr is the fix.
   */
  function rawKeplr(
    overrides: Partial<KeplrInjectedProviderLike> = {}
  ): KeplrInjectedProviderLike {
    return {
      enable: vi.fn().mockResolvedValue(undefined),
      getKey: vi.fn().mockResolvedValue({
        name: 'my wallet',
        algo: 'secp256k1',
        pubKey: new Uint8Array([1, 2, 3]),
        bech32Address: 'cosmos1abcdef',
        isNanoLedger: false,
      }),
      getOfflineSigner: vi.fn().mockReturnValue({ signDirect: vi.fn() }),
      getOfflineSignerOnlyAmino: vi.fn().mockReturnValue({ signAmino: vi.fn() }),
      signAmino: vi.fn(),
      signDirect: vi.fn(),
      signArbitrary: vi.fn(),
      suggestToken: vi.fn(),
      sendTx: vi.fn(),
      ...overrides,
    };
  }

  it('REGRESSION: a raw injected provider lacks connect / getAccount / getSimpleAccount; fromKeplr adds them', () => {
    const raw = rawKeplr();
    // The bug: the raw provider (what window.keplr actually is) does NOT have
    // the methods cosmiframe proxies during connect.
    expect(typeof (raw as Record<string, unknown>)['connect']).not.toBe(
      'function'
    );
    expect(typeof (raw as Record<string, unknown>)['getAccount']).not.toBe(
      'function'
    );
    expect(
      typeof (raw as Record<string, unknown>)['getSimpleAccount']
    ).not.toBe('function');

    // fromKeplr produces a VALID Cosmiframe target that DOES expose them.
    const handle = fromKeplr(raw);
    const t = handle.target;
    expect(typeof t['connect']).toBe('function');
    expect(typeof t['enable']).toBe('function');
    expect(typeof t['getKey']).toBe('function');
    expect(typeof t['getAccount']).toBe('function');
    expect(typeof t['getSimpleAccount']).toBe('function');
    // Signer getters present on the handle.
    expect(typeof handle.getOfflineSignerDirect).toBe('function');
    expect(typeof handle.getOfflineSignerAmino).toBe('function');
  });

  it('derives getAccount from getKey exactly as @cosmos-kit/keplr-extension does', async () => {
    const raw = rawKeplr();
    const handle = fromKeplr(raw);
    const getAccount = handle.target['getAccount'] as (
      chainId: string
    ) => Promise<Record<string, unknown>>;
    const account = await getAccount('cosmoshub-4');
    expect(raw.getKey).toHaveBeenCalledWith('cosmoshub-4');
    // { username: key.name, address: key.bech32Address, algo: key.algo,
    //   pubkey: key.pubKey, isNanoLedger: key.isNanoLedger }
    expect(account).toEqual({
      username: 'my wallet',
      address: 'cosmos1abcdef',
      algo: 'secp256k1',
      pubkey: new Uint8Array([1, 2, 3]),
      isNanoLedger: false,
    });
  });

  it('derives getSimpleAccount from getAccount exactly as @cosmos-kit/keplr-extension does', async () => {
    const handle = fromKeplr(rawKeplr());
    const getSimpleAccount = handle.target['getSimpleAccount'] as (
      chainId: string
    ) => Promise<Record<string, unknown>>;
    const simple = await getSimpleAccount('cosmoshub-4');
    // { namespace: 'cosmos', chainId, address, username }
    expect(simple).toEqual({
      namespace: 'cosmos',
      chainId: 'cosmoshub-4',
      address: 'cosmos1abcdef',
      username: 'my wallet',
    });
  });

  it('connect() enables the requested chains on the raw provider (no-op when none given)', async () => {
    const raw = rawKeplr();
    const handle = fromKeplr(raw);
    const connect = handle.target['connect'] as (
      chainIds?: string | string[]
    ) => Promise<void>;
    await connect('cosmoshub-4');
    expect(raw.enable).toHaveBeenCalledWith('cosmoshub-4');

    (raw.enable as ReturnType<typeof vi.fn>).mockClear();
    await connect();
    expect(raw.enable).not.toHaveBeenCalled();
  });

  it('forwards getKey / sign* / suggestToken / sendTx verbatim to the raw provider', async () => {
    const raw = rawKeplr();
    const handle = fromKeplr(raw);
    const getKey = handle.target['getKey'] as (c: string) => Promise<unknown>;
    await getKey('cosmoshub-4');
    expect(raw.getKey).toHaveBeenCalledWith('cosmoshub-4');
    expect(typeof handle.target['signAmino']).toBe('function');
    expect(typeof handle.target['signDirect']).toBe('function');
    expect(typeof handle.target['suggestToken']).toBe('function');
    expect(typeof handle.target['sendTx']).toBe('function');
  });

  it('signer getters call the raw provider offline-signer factories', () => {
    const raw = rawKeplr();
    const handle = fromKeplr(raw);
    handle.getOfflineSignerDirect('cosmoshub-4');
    handle.getOfflineSignerAmino('cosmoshub-4');
    expect(raw.getOfflineSigner).toHaveBeenCalledWith('cosmoshub-4');
    expect(raw.getOfflineSignerOnlyAmino).toHaveBeenCalledWith('cosmoshub-4');
  });

  it('does NOT advertise optional methods the raw provider omits', () => {
    // A minimal provider with only the required methods. The target must not
    // expose signAmino/sendTx/etc as undefined functions (the cosmiframe
    // listener checks typeof target[m] === 'function').
    const raw: KeplrInjectedProviderLike = {
      enable: vi.fn(),
      getKey: vi.fn().mockResolvedValue({
        name: 'n',
        algo: 'secp256k1',
        pubKey: new Uint8Array(),
        bech32Address: 'cosmos1x',
        isNanoLedger: false,
      }),
      getOfflineSigner: vi.fn(),
      getOfflineSignerOnlyAmino: vi.fn(),
    };
    const handle = fromKeplr(raw);
    expect('signAmino' in handle.target).toBe(false);
    expect('sendTx' in handle.target).toBe(false);
    expect('suggestToken' in handle.target).toBe(false);
    // But the always-derived / required ones are present.
    expect(typeof handle.target['connect']).toBe('function');
    expect(typeof handle.target['getAccount']).toBe('function');
    expect(typeof handle.target['getSimpleAccount']).toBe('function');
  });

  it('exposes an addChain that throws a CLEAR, actionable error (not the cryptic cosmiframe message)', async () => {
    // cosmos-kit's recovery path proxies client.addChain(chainRecord) through
    // CosmiframeClient; the parent listener invokes target.addChain(...). Without
    // an addChain on the target the listener throws "No method 'addChain' on
    // target". The helper instead provides one that throws an actionable error.
    const handle = fromKeplr(rawKeplr());
    expect(typeof handle.target['addChain']).toBe('function');
    const addChain = handle.target['addChain'] as (
      chain?: unknown
    ) => Promise<never>;
    // With a chainRecord carrying chainId, the message names the chain.
    await expect(addChain({ chainId: 'osmosis-1' })).rejects.toThrow(
      /the wallet does not have osmosis-1 added/
    );
    await expect(addChain({ chainId: 'osmosis-1' })).rejects.toThrow(
      /Add it in your wallet first, or use fromCosmosKit which can add chains\./
    );
    // It must NOT surface the cryptic cosmiframe message.
    await expect(addChain({ chainId: 'osmosis-1' })).rejects.not.toThrow(
      /No method 'addChain' on target/
    );
    // With no usable chainId it falls back to a generic phrasing, still actionable.
    await expect(addChain()).rejects.toThrow(
      /the wallet does not have the requested chain added/
    );
    await expect(addChain('not-an-object')).rejects.toThrow(
      /the requested chain/
    );
  });

  it('addChain is named via fromInjectedCosmosWallet in the error message and survives the undefined-method prune', () => {
    const handle = fromInjectedCosmosWallet(rawKeplr());
    expect('addChain' in handle.target).toBe(true);
    const addChain = handle.target['addChain'] as (
      chain?: unknown
    ) => Promise<never>;
    return expect(addChain({ chainId: 'juno-1' })).rejects.toThrow(
      /fromInjectedCosmosWallet:/
    );
  });

  it('attaches metadata when supplied and omits it otherwise', () => {
    const withMeta = fromKeplr(rawKeplr(), { metadata: { name: 'Cosmostation' } });
    expect(withMeta.metadata).toEqual({ name: 'Cosmostation' });
    const without = fromKeplr(rawKeplr());
    expect('metadata' in without).toBe(false);
  });

  it('throws when the provider is missing required raw methods', () => {
    expect(() =>
      fromKeplr({ getKey: vi.fn() } as unknown as KeplrInjectedProviderLike)
    ).toThrow(/raw injected/);
    expect(() =>
      fromKeplr(null as unknown as KeplrInjectedProviderLike)
    ).toThrow(/raw injected/);
    expect(() =>
      fromKeplr({
        enable: vi.fn(),
        getKey: vi.fn(),
        getOfflineSigner: vi.fn(),
        // missing getOfflineSignerOnlyAmino
      } as unknown as KeplrInjectedProviderLike)
    ).toThrow(/raw injected/);
  });
});

describe('fromInjectedCosmosWallet() (rename of fromKeplr)', () => {
  /**
   * A Cosmostation-keplr-shaped injected provider: exactly what
   * `window.cosmostation.providers.keplr` exposes - the Keplr injected API
   * (getKey / enable / getOfflineSigner / getOfflineSignerOnlyAmino), but NOT
   * connect / getAccount / getSimpleAccount. The helper must wrap it into a
   * valid Cosmiframe target the same way it does for window.keplr.
   */
  function cosmostationKeplr(): KeplrInjectedProviderLike {
    return {
      enable: vi.fn().mockResolvedValue(undefined),
      getKey: vi.fn().mockResolvedValue({
        name: 'cosmostation acct',
        algo: 'secp256k1',
        pubKey: new Uint8Array([9, 8, 7]),
        bech32Address: 'cosmos1cosmostationkeplr',
        isNanoLedger: false,
      }),
      getOfflineSigner: vi.fn().mockReturnValue({ signDirect: vi.fn() }),
      getOfflineSignerOnlyAmino: vi.fn().mockReturnValue({ signAmino: vi.fn() }),
    };
  }

  it('wraps a Cosmostation-keplr-shaped provider into a valid Cosmiframe target', async () => {
    const provider = cosmostationKeplr();
    const handle = fromInjectedCosmosWallet(provider);
    const t = handle.target;
    expect(typeof t['connect']).toBe('function');
    expect(typeof t['enable']).toBe('function');
    expect(typeof t['getKey']).toBe('function');
    expect(typeof t['getAccount']).toBe('function');
    expect(typeof t['getSimpleAccount']).toBe('function');

    const account = await (t['getAccount'] as (c: string) => Promise<unknown>)(
      'cosmoshub-4'
    );
    expect(account).toEqual({
      username: 'cosmostation acct',
      address: 'cosmos1cosmostationkeplr',
      algo: 'secp256k1',
      pubkey: new Uint8Array([9, 8, 7]),
      isNanoLedger: false,
    });
    const simple = await (
      t['getSimpleAccount'] as (c: string) => Promise<unknown>
    )('cosmoshub-4');
    expect(simple).toEqual({
      namespace: 'cosmos',
      chainId: 'cosmoshub-4',
      address: 'cosmos1cosmostationkeplr',
      username: 'cosmostation acct',
    });
  });

  it('fromKeplr is a back-compat alias that behaves identically to fromInjectedCosmosWallet', () => {
    // Same function reference (re-export alias).
    expect(fromKeplr).toBe(fromInjectedCosmosWallet);

    const provider = cosmostationKeplr();
    const viaAlias = fromKeplr(provider, { metadata: { name: 'Cosmostation' } });
    const viaNew = fromInjectedCosmosWallet(cosmostationKeplr(), {
      metadata: { name: 'Cosmostation' },
    });
    expect(typeof viaAlias.target['connect']).toBe('function');
    expect(typeof viaAlias.target['getAccount']).toBe('function');
    expect(viaAlias.metadata).toEqual({ name: 'Cosmostation' });
    expect(Object.keys(viaAlias.target).sort()).toEqual(
      Object.keys(viaNew.target).sort()
    );
  });

  it('throws on an invalid provider, with the new helper name in the message', () => {
    expect(() =>
      fromInjectedCosmosWallet(
        { getKey: vi.fn() } as unknown as KeplrInjectedProviderLike
      )
    ).toThrow(/fromInjectedCosmosWallet/);
  });
});

describe('fromWagmi()', () => {
  it('wraps a resolved EIP-1193 provider into a WalletEvmHandle', () => {
    const provider: Eip1193ProviderLike = { request: vi.fn() };
    const handle = fromWagmi(provider);
    expect(handle.provider).toBe(provider);
  });

  it('accepts a CALLABLE provider (typeof === "function") that carries a request method', () => {
    // Some providers are callable objects. fromWagmi must accept them as long as
    // `request` is a function.
    const callable = Object.assign(
      function callableProvider() {
        /* some providers are callable */
      },
      { request: vi.fn() }
    ) as unknown as Eip1193ProviderLike;
    expect(typeof callable).toBe('function');
    const handle = fromWagmi(callable);
    expect(handle.provider).toBe(callable);
  });

  it('still throws for a function with NO request method', () => {
    const fnNoRequest = function noRequest() {
      /* not a provider */
    } as unknown as Eip1193ProviderLike;
    expect(() => fromWagmi(fnNoRequest)).toThrow(/EIP-1193 provider/);
  });

  it('throws when the provider lacks request()', () => {
    expect(() =>
      fromWagmi({ on: vi.fn() } as unknown as Eip1193ProviderLike)
    ).toThrow(/EIP-1193 provider/);
  });

  it('throws when given a non-object', () => {
    expect(() =>
      fromWagmi(undefined as unknown as Eip1193ProviderLike)
    ).toThrow(/EIP-1193 provider/);
  });
});
