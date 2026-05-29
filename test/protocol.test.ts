import { describe, it, expect } from 'vitest';

import {
  isHandshakeMessage,
  isResizeMessage,
  isWidgetEventMessage,
  isProtocolMessage,
  isCompatibleProtocol,
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
});
