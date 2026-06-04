import { describe, it, expect } from 'vitest';

import {
  isHandshakeMessage,
  isResizeMessage,
  isWidgetEventMessage,
  isProtocolMessage,
  isEvmRequestMessage,
  isWalletHelloMessage,
  isWalletConnectRequestMessage,
  isWalletCapabilitiesMessage,
  isWalletSignalMessage,
  isCompatibleProtocol,
  EVM_BRIDGE_NS,
  WALLET_SIGNAL_NS,
  PROTOCOL_VERSION,
  WIDGET_ORIGIN,
  WIDGET_PATH,
} from '../src/protocol.js';

describe('protocol', () => {
  describe('PROTOCOL_VERSION', () => {
    it('is the locked wire version (1.x major)', () => {
      expect(PROTOCOL_VERSION).toBe('1.0.0');
    });
  });

  describe('WIDGET_ORIGIN', () => {
    it('is the production widget origin, no trailing slash', () => {
      expect(WIDGET_ORIGIN).toBe('https://atomcircuit.net');
      expect(WIDGET_PATH).toBe('/embed/swap');
    });
  });

  describe('isHandshakeMessage', () => {
    it('accepts a valid handshake', () => {
      expect(
        isHandshakeMessage({
          type: 'handshake',
          protocolVersion: '1.0.0',
          capabilities: ['swap.submit', 'resize.report'],
        })
      ).toBe(true);
    });
    it('accepts an empty capabilities array', () => {
      expect(
        isHandshakeMessage({ type: 'handshake', protocolVersion: '1.0.0', capabilities: [] })
      ).toBe(true);
    });
    it('rejects wrong type tag', () => {
      expect(
        isHandshakeMessage({ type: 'hello', protocolVersion: '1.0.0', capabilities: [] })
      ).toBe(false);
    });
    it('rejects missing protocolVersion', () => {
      expect(isHandshakeMessage({ type: 'handshake', capabilities: [] })).toBe(false);
    });
    it('rejects non-string capability entries', () => {
      expect(
        isHandshakeMessage({ type: 'handshake', protocolVersion: '1.0.0', capabilities: [1, 2] })
      ).toBe(false);
    });
    it('rejects null', () => {
      expect(isHandshakeMessage(null)).toBe(false);
    });
    it('rejects primitives', () => {
      expect(isHandshakeMessage('handshake')).toBe(false);
      expect(isHandshakeMessage(42)).toBe(false);
    });
  });

  describe('isResizeMessage', () => {
    it('accepts a positive height', () => {
      expect(isResizeMessage({ type: 'atomcircuit:resize', height: 720 })).toBe(true);
    });
    it('accepts zero', () => {
      expect(isResizeMessage({ type: 'atomcircuit:resize', height: 0 })).toBe(true);
    });
    it('rejects negative height', () => {
      expect(isResizeMessage({ type: 'atomcircuit:resize', height: -1 })).toBe(false);
    });
    it('rejects NaN height', () => {
      expect(isResizeMessage({ type: 'atomcircuit:resize', height: Number.NaN })).toBe(false);
    });
    it('rejects Infinity', () => {
      expect(
        isResizeMessage({ type: 'atomcircuit:resize', height: Number.POSITIVE_INFINITY })
      ).toBe(false);
    });
    it('rejects string height', () => {
      expect(isResizeMessage({ type: 'atomcircuit:resize', height: '720' })).toBe(false);
    });
    it('rejects wrong type', () => {
      expect(isResizeMessage({ type: 'resize', height: 720 })).toBe(false);
    });
  });

  describe('isWidgetEventMessage', () => {
    it('accepts ready event', () => {
      expect(
        isWidgetEventMessage({ type: 'atomcircuit:event', name: 'ready', payload: {} })
      ).toBe(true);
    });
    it('accepts swap:submitted event', () => {
      expect(
        isWidgetEventMessage({
          type: 'atomcircuit:event',
          name: 'swap:submitted',
          payload: { txHash: '0xabc' },
        })
      ).toBe(true);
    });
    it('accepts events with no payload', () => {
      expect(isWidgetEventMessage({ type: 'atomcircuit:event', name: 'ready' })).toBe(true);
    });
    it('rejects unknown event name', () => {
      expect(
        isWidgetEventMessage({ type: 'atomcircuit:event', name: 'wallet:connected' })
      ).toBe(false);
    });
    it('rejects wrong type tag', () => {
      expect(isWidgetEventMessage({ type: 'event', name: 'ready' })).toBe(false);
    });
  });

  describe('isProtocolMessage', () => {
    it('matches every valid variant', () => {
      expect(isProtocolMessage({ type: 'handshake', protocolVersion: '1.0.0', capabilities: [] })).toBe(true);
      expect(isProtocolMessage({ type: 'atomcircuit:resize', height: 100 })).toBe(true);
      expect(isProtocolMessage({ type: 'atomcircuit:event', name: 'ready' })).toBe(true);
    });
    it('rejects unknown variants', () => {
      expect(isProtocolMessage({ type: 'rpc:call', method: 'foo' })).toBe(false);
      expect(isProtocolMessage({})).toBe(false);
    });
  });

  describe('isCompatibleProtocol', () => {
    it('accepts matching majors', () => {
      expect(isCompatibleProtocol('1.0.0', '1.5.3')).toBe(true);
    });
    it('rejects differing majors', () => {
      expect(isCompatibleProtocol('1.0.0', '2.0.0')).toBe(false);
    });
    it('rejects malformed versions', () => {
      expect(isCompatibleProtocol('', '1.0.0')).toBe(false);
    });
  });

  describe('isEvmRequestMessage', () => {
    it('accepts a well-formed request envelope with and without params', () => {
      expect(
        isEvmRequestMessage({
          ns: EVM_BRIDGE_NS,
          kind: 'request',
          id: 'r1',
          method: 'eth_chainId',
          params: [],
        })
      ).toBe(true);
      expect(
        isEvmRequestMessage({
          ns: EVM_BRIDGE_NS,
          kind: 'request',
          id: 'r1',
          method: 'eth_accounts',
        })
      ).toBe(true);
    });

    it('rejects wrong ns, wrong kind, missing/typed-wrong fields, and non-array params', () => {
      expect(isEvmRequestMessage(null)).toBe(false);
      expect(isEvmRequestMessage('x')).toBe(false);
      expect(
        isEvmRequestMessage({ kind: 'request', id: 'r', method: 'm' })
      ).toBe(false); // no ns
      expect(
        isEvmRequestMessage({ ns: 'other', kind: 'request', id: 'r', method: 'm' })
      ).toBe(false);
      expect(
        isEvmRequestMessage({ ns: EVM_BRIDGE_NS, kind: 'response', id: 'r', method: 'm' })
      ).toBe(false);
      expect(
        isEvmRequestMessage({ ns: EVM_BRIDGE_NS, kind: 'request', method: 'm' })
      ).toBe(false); // no id
      expect(
        isEvmRequestMessage({ ns: EVM_BRIDGE_NS, kind: 'request', id: 1, method: 'm' })
      ).toBe(false); // non-string id
      expect(
        isEvmRequestMessage({ ns: EVM_BRIDGE_NS, kind: 'request', id: 'r' })
      ).toBe(false); // no method
      expect(
        isEvmRequestMessage({
          ns: EVM_BRIDGE_NS,
          kind: 'request',
          id: 'r',
          method: 'm',
          params: 'nope',
        })
      ).toBe(false);
    });
  });

  describe('isWalletHelloMessage', () => {
    it('accepts a well-formed hello', () => {
      expect(isWalletHelloMessage({ ns: WALLET_SIGNAL_NS, kind: 'hello' })).toBe(true);
    });
    it('rejects wrong ns / wrong kind / primitives', () => {
      expect(isWalletHelloMessage({ ns: 'other', kind: 'hello' })).toBe(false);
      expect(isWalletHelloMessage({ ns: WALLET_SIGNAL_NS, kind: 'ready' })).toBe(false);
      expect(isWalletHelloMessage(null)).toBe(false);
      expect(isWalletHelloMessage('hello')).toBe(false);
    });
    // hello and the EVM namespace must never cross-trigger.
    it('does NOT match an EVM request envelope', () => {
      expect(
        isWalletHelloMessage({ ns: EVM_BRIDGE_NS, kind: 'hello' })
      ).toBe(false);
    });
  });

  describe('isWalletConnectRequestMessage', () => {
    it('accepts a connect-request for each known channel', () => {
      expect(
        isWalletConnectRequestMessage({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'cosmos' })
      ).toBe(true);
      expect(
        isWalletConnectRequestMessage({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'evm' })
      ).toBe(true);
    });
    it('rejects wrong ns / wrong kind / unknown or missing channel', () => {
      expect(
        isWalletConnectRequestMessage({ ns: 'other', kind: 'connect-request', channel: 'cosmos' })
      ).toBe(false);
      expect(
        isWalletConnectRequestMessage({ ns: WALLET_SIGNAL_NS, kind: 'ready', channel: 'cosmos' })
      ).toBe(false);
      expect(
        isWalletConnectRequestMessage({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'svm' })
      ).toBe(false);
      expect(
        isWalletConnectRequestMessage({ ns: WALLET_SIGNAL_NS, kind: 'connect-request' })
      ).toBe(false);
      expect(isWalletConnectRequestMessage(null)).toBe(false);
    });
  });

  describe('isWalletCapabilitiesMessage', () => {
    it('accepts capabilities with and without connectPrompt', () => {
      expect(
        isWalletCapabilitiesMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: true, evm: false },
        })
      ).toBe(true);
      expect(
        isWalletCapabilitiesMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: true, evm: true },
          connectPrompt: 'Connect on the parent page',
        })
      ).toBe(true);
    });
    it('rejects non-boolean canRequestConnect entries / missing channel / non-string connectPrompt', () => {
      expect(
        isWalletCapabilitiesMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: 'yes', evm: true },
        })
      ).toBe(false);
      expect(
        isWalletCapabilitiesMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: true },
        })
      ).toBe(false);
      expect(
        isWalletCapabilitiesMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: true, evm: true },
          connectPrompt: 42,
        })
      ).toBe(false);
      expect(
        isWalletCapabilitiesMessage({ ns: 'other', kind: 'capabilities', canRequestConnect: { cosmos: true, evm: true } })
      ).toBe(false);
      expect(isWalletCapabilitiesMessage(null)).toBe(false);
    });
  });

  describe('isWalletSignalMessage', () => {
    it('matches every control + ready/gone variant on the wallet namespace', () => {
      expect(isWalletSignalMessage({ ns: WALLET_SIGNAL_NS, kind: 'hello' })).toBe(true);
      expect(
        isWalletSignalMessage({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'evm' })
      ).toBe(true);
      expect(
        isWalletSignalMessage({
          ns: WALLET_SIGNAL_NS,
          kind: 'capabilities',
          canRequestConnect: { cosmos: false, evm: false },
        })
      ).toBe(true);
      expect(
        isWalletSignalMessage({ ns: WALLET_SIGNAL_NS, kind: 'ready', channels: ['cosmos'] })
      ).toBe(true);
      expect(
        isWalletSignalMessage({ ns: WALLET_SIGNAL_NS, kind: 'gone', channels: ['evm'] })
      ).toBe(true);
    });
    it('rejects an EVM envelope and unknown kinds', () => {
      expect(
        isWalletSignalMessage({ ns: EVM_BRIDGE_NS, kind: 'request', id: 'x', method: 'm' })
      ).toBe(false);
      expect(isWalletSignalMessage({ ns: WALLET_SIGNAL_NS, kind: 'bogus' })).toBe(false);
    });
  });
});
