/**
 * Host-side client that wraps Penpal v7 for typed RPC plus a custom
 * event emitter for streamed widget events (resize, ready, swap:*).
 *
 * Strict origin validation is enforced two ways:
 *   1. Penpal's `WindowMessenger({ allowedOrigins })` filters at the messenger layer.
 *   2. A second `MessageEvent` listener double-checks `event.origin` before
 *      acknowledging stream events. Two-tier check is intentional: it ensures
 *      we never trust a payload coming through a future Penpal change that
 *      relaxes origin handling.
 */

import {
  connect,
  WindowMessenger,
  type Connection,
  type Messenger,
  type Methods,
} from 'penpal';

import {
  PROTOCOL_VERSION,
  WIDGET_ORIGIN,
  isCompatibleProtocol,
  isProtocolMessage,
  isResizeMessage,
  isWidgetEventMessage,
  type Capabilities,
  type HandshakeMessage,
  type ReadyPayload,
  type SwapErrorPayload,
  type SwapSubmittedPayload,
  type SwapSuccessPayload,
  type WidgetEventName,
  type WidgetEventMessage,
} from './protocol.js';

/**
 * Methods the iframe can call on the host. Kept tiny: only the handshake
 * reply path is used. Stream events arrive through raw postMessage to keep
 * the iframe implementation simple.
 */
export interface HostMethods extends Methods {
  /**
   * Reports the iframe's handshake details. Resolves once the host has
   * recorded the capability set.
   */
  handshake(payload: HandshakeMessage): void;
}

/**
 * Methods the host may call on the iframe. The widget surface is narrow:
 * a `ping` liveness probe is the only RPC the SDK relies on; the primary
 * path is user-driven inside the widget.
 */
export interface RemoteMethods extends Methods {
  /**
   * Returns the protocol version the iframe is running. Used as a liveness
   * probe in tests.
   */
  ping(): string;
}

/**
 * Per-event handler signatures. Keeps the public surface free of `any`.
 */
export interface EventHandlers {
  ready: (payload: ReadyPayload) => void;
  resize: (info: { height: number }) => void;
  'swap:submitted': (payload: SwapSubmittedPayload) => void;
  'swap:success': (payload: SwapSuccessPayload) => void;
  'swap:error': (payload: SwapErrorPayload) => void;
}

export type EventName = keyof EventHandlers;

export interface IframeClientOptions {
  /**
   * The iframe element. Must already be appended to the DOM and have its
   * `src` set so `iframe.contentWindow` is non-null by the time `init()`
   * resolves.
   */
  iframe: HTMLIFrameElement;
  /**
   * Origin to trust for postMessage. Defaults to {@link WIDGET_ORIGIN}.
   */
  allowedOrigin?: string;
  /**
   * Connection timeout in milliseconds. Default 15000.
   */
  timeoutMs?: number;
  /**
   * Optional warning sink. Defaults to a no-op (the SDK refuses to write to
   * console.log per project policy).
   */
  warn?: (message: string) => void;
}

interface PenpalConnectFn {
  <T extends Methods>(opts: {
    messenger: Messenger;
    methods?: Methods;
    timeout?: number;
  }): Connection<T>;
}

const noopWarn = (_message: string): void => {
  /* silent by default */
};

/**
 * Typed Penpal RPC client + stream-event hub. One instance per iframe.
 */
export class IframeClient {
  private readonly iframe: HTMLIFrameElement;
  private readonly allowedOrigin: string;
  private readonly timeoutMs: number;
  private readonly warn: (message: string) => void;

  private connection: Connection<RemoteMethods> | null = null;
  private rawListener: ((event: MessageEvent) => void) | null = null;
  private destroyed = false;
  private handshakeReceived: HandshakeMessage | null = null;
  private handshakeResolvers: Array<(value: HandshakeMessage) => void> = [];

  private readonly handlers: {
    [K in EventName]: Set<EventHandlers[K]>;
  } = {
    ready: new Set(),
    resize: new Set(),
    'swap:submitted': new Set(),
    'swap:success': new Set(),
    'swap:error': new Set(),
  };

  constructor(opts: IframeClientOptions) {
    this.iframe = opts.iframe;
    this.allowedOrigin = opts.allowedOrigin ?? WIDGET_ORIGIN;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.warn = opts.warn ?? noopWarn;
  }

  /**
   * Opens the Penpal connection and starts listening for stream events.
   * Resolves once the remote handshake has been received.
   */
  async init(): Promise<HandshakeMessage> {
    if (this.destroyed) {
      throw new Error('IframeClient: cannot init after destroy()');
    }
    if (this.connection) {
      throw new Error('IframeClient: already initialised');
    }

    const remoteWindow = this.iframe.contentWindow;
    if (!remoteWindow) {
      throw new Error('IframeClient: iframe.contentWindow is null');
    }

    this.rawListener = (event: MessageEvent): void => {
      this.handleRawMessage(event);
    };
    window.addEventListener('message', this.rawListener);

    const messenger = new WindowMessenger({
      remoteWindow,
      allowedOrigins: [this.allowedOrigin],
    });

    const hostMethods: HostMethods = {
      handshake: (payload: HandshakeMessage): void => {
        this.recordHandshake(payload);
      },
    };

    const typedConnect = connect as PenpalConnectFn;
    this.connection = typedConnect<RemoteMethods>({
      messenger,
      methods: hostMethods,
      timeout: this.timeoutMs,
    });

    // Wait for Penpal's own connection promise to resolve; this guarantees
    // both sides have exchanged Penpal's own SYN/ACK frames.
    await this.connection.promise;

    // If the iframe used the raw postMessage handshake path instead of the
    // RPC method, the handshake may have already arrived through
    // handleRawMessage. Either way, wait for it (bounded).
    return this.waitForHandshake();
  }

  /**
   * Subscribe to a named stream event. Returns an unsubscribe function.
   */
  on<K extends EventName>(name: K, handler: EventHandlers[K]): () => void {
    this.handlers[name].add(handler);
    return () => this.off(name, handler);
  }

  /**
   * Remove a registered handler.
   */
  off<K extends EventName>(name: K, handler: EventHandlers[K]): void {
    this.handlers[name].delete(handler);
  }

  /**
   * Tears down the Penpal connection, removes the raw listener, and clears
   * every event subscriber. Safe to call multiple times.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.rawListener) {
      window.removeEventListener('message', this.rawListener);
      this.rawListener = null;
    }
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    for (const set of Object.values(this.handlers)) {
      set.clear();
    }
    this.handshakeResolvers = [];
  }

  /**
   * Returns the handshake payload received from the iframe, or null if no
   * handshake has been observed yet.
   */
  getHandshake(): HandshakeMessage | null {
    return this.handshakeReceived;
  }

  /**
   * Returns true if the iframe advertised the given capability in its
   * handshake. Returns false when no handshake has been received yet or
   * when the capability is not present.
   *
   * Callers wrapping a method that requires a capability should gate on
   * `client.has('cap')` before invoking it. Calls to capabilities the
   * iframe does not advertise are silent no-ops at the call-site (or
   * resolve to `null`); the iframe is the source of truth for what it
   * implements.
   */
  has(capability: string): boolean {
    const list = this.handshakeReceived?.capabilities;
    if (!list) return false;
    for (const entry of list) {
      if (entry === capability) return true;
    }
    return false;
  }

  /**
   * Test-only seam. Allows unit tests to invoke the message handler without
   * dispatching real `MessageEvent`s through the JSDOM bus.
   */
  /* v8 ignore next 3 */
  _handleMessageForTest(event: MessageEvent): void {
    this.handleRawMessage(event);
  }

  /* --------------------------------------------------------------------- */

  private handleRawMessage(event: MessageEvent): void {
    if (event.origin !== this.allowedOrigin) {
      return;
    }
    if (event.source !== this.iframe.contentWindow) {
      return;
    }
    const data: unknown = event.data;
    if (!isProtocolMessage(data)) {
      return;
    }

    if (data.type === 'handshake') {
      this.recordHandshake(data);
      return;
    }

    if (isResizeMessage(data)) {
      this.emitResize(data.height);
      return;
    }

    if (isWidgetEventMessage(data)) {
      this.dispatchWidgetEvent(data);
    }
  }

  private recordHandshake(payload: HandshakeMessage): void {
    this.handshakeReceived = payload;
    if (!isCompatibleProtocol(PROTOCOL_VERSION, payload.protocolVersion)) {
      this.warn(
        `Atom Circuit embed: protocol mismatch (sdk=${PROTOCOL_VERSION}, iframe=${payload.protocolVersion}). Some features may be unavailable.`
      );
    }
    const resolvers = this.handshakeResolvers;
    this.handshakeResolvers = [];
    for (const resolve of resolvers) {
      resolve(payload);
    }
  }

  private waitForHandshake(): Promise<HandshakeMessage> {
    if (this.handshakeReceived) {
      return Promise.resolve(this.handshakeReceived);
    }
    return new Promise<HandshakeMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.handshakeResolvers.indexOf(wrapped);
        if (idx >= 0) this.handshakeResolvers.splice(idx, 1);
        reject(new Error('IframeClient: handshake timeout'));
      }, this.timeoutMs);
      const wrapped = (value: HandshakeMessage): void => {
        clearTimeout(timer);
        resolve(value);
      };
      this.handshakeResolvers.push(wrapped);
    });
  }

  private emitResize(height: number): void {
    for (const fn of this.handlers.resize) {
      fn({ height });
    }
  }

  private dispatchWidgetEvent(message: WidgetEventMessage): void {
    const name: WidgetEventName = message.name;
    switch (name) {
      case 'ready':
        this.emitReady((message.payload as ReadyPayload | undefined) ?? {
          protocolVersion: this.handshakeReceived?.protocolVersion ?? 'unknown',
        });
        return;
      case 'swap:submitted':
        this.emitTyped('swap:submitted', message.payload as SwapSubmittedPayload);
        return;
      case 'swap:success':
        this.emitTyped('swap:success', message.payload as SwapSuccessPayload);
        return;
      case 'swap:error':
        this.emitTyped('swap:error', message.payload as SwapErrorPayload);
        return;
      /* v8 ignore next 2 */
      default:
        return;
    }
  }

  private emitReady(payload: ReadyPayload): void {
    for (const fn of this.handlers.ready) {
      fn(payload);
    }
  }

  private emitTyped<K extends Exclude<EventName, 'ready' | 'resize'>>(
    name: K,
    payload: Parameters<EventHandlers[K]>[0]
  ): void {
    for (const fn of this.handlers[name]) {
      (fn as (p: unknown) => void)(payload);
    }
  }
}

/**
 * Exported for advanced callers that need the trusted origin without
 * importing the protocol module directly.
 */
export const TRUSTED_ORIGIN = WIDGET_ORIGIN;

/**
 * Re-export so consumers can capability-gate calls without importing the
 * protocol module.
 */
export type { Capabilities };
