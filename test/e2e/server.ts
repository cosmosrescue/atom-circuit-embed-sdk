/**
 * Tiny dual-origin static HTTP server for the Playwright cross-origin
 * handshake test.
 *
 * Two servers are spawned on disjoint ephemeral ports of 127.0.0.1, both
 * announcing themselves as distinct origins to the browser:
 *
 *   - hostServer   serves the host page (`host.html`). This is the "outer"
 *                  page that calls `mount(...)`. It exposes a single route:
 *                    GET /                -> host.html
 *
 *   - iframeServer serves the mock dapp iframe (`iframe.html`) plus the
 *                  Penpal browser bundle and the SDK IIFE so the iframe can
 *                  run a real Penpal handshake from a cross-origin context.
 *                  It exposes:
 *                    GET /iframe.html     -> iframe.html
 *                    GET /penpal.min.js   -> node_modules/penpal/dist/penpal.min.js
 *                    GET /sdk.js          -> dist/atom-circuit.iife.js
 *
 * The host page receives the iframe origin via a `?iframeOrigin=...` query
 * parameter so it knows where to mount the SDK; the iframe page receives
 * the host origin via `?hostOrigin=...` (forwarded by the SDK as part of
 * the iframe URL) so its WindowMessenger can be configured with the right
 * allowedOrigins. The SDK is the one that constructs the iframe URL, so
 * the host page passes `hostOrigin` through `MountOptions.path`.
 *
 * Why two servers (not one with virtual hosts):
 *   - The browser keys cross-origin postMessage checks off the full origin
 *     tuple (scheme + host + port). Different ports on the same host count
 *     as different origins, which is exactly the boundary we need to
 *     exercise without provisioning DNS or TLS.
 *
 * No third-party HTTP framework: this file uses only `node:http` /
 * `node:fs` so adding a dev dep just for the test is unnecessary.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

// ESM-safe equivalents of __dirname / __filename. The package is
// `"type": "module"` so we cannot rely on the CommonJS globals.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const SDK_IIFE_PATH = resolve(REPO_ROOT, 'dist', 'atom-circuit.iife.js');
const PENPAL_PATH = resolve(REPO_ROOT, 'node_modules', 'penpal', 'dist', 'penpal.min.js');
const HOST_HTML_PATH = resolve(FIXTURES_DIR, 'host.html');
const IFRAME_HTML_PATH = resolve(FIXTURES_DIR, 'iframe.html');

export interface RunningServers {
  hostOrigin: string;
  iframeOrigin: string;
  close(): Promise<void>;
}

function readFile(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new Error(
      `Test fixture missing: ${path}. Did you run \`npm run build\` first? Original: ${(err as Error).message}`
    );
  }
}

function sendFile(
  res: ServerResponse,
  body: Buffer,
  contentType: string
): void {
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    // Permissive CORS so the browser does not block fetching the SDK script
    // from the iframe origin if Playwright introduces a preflight.
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function send404(res: ServerResponse, path: string): void {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end(`Not found: ${path}\n`);
}

function makeHostHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  // Read fixture once at startup so a missing fixture fails fast.
  const hostHtml = readFile(HOST_HTML_PATH);
  return (req, res) => {
    const url = req.url ?? '/';
    // The query string is preserved by the browser when navigating, but we
    // serve the same HTML regardless of the path: the host page reads its
    // own search params client-side.
    if (url === '/' || url.startsWith('/?') || url === '/host.html' || url.startsWith('/host.html?')) {
      sendFile(res, hostHtml, 'text/html; charset=utf-8');
      return;
    }
    send404(res, url);
  };
}

function makeIframeHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  const iframeHtml = readFile(IFRAME_HTML_PATH);
  const penpal = readFile(PENPAL_PATH);
  const sdk = readFile(SDK_IIFE_PATH);
  return (req, res) => {
    const url = req.url ?? '/';
    // Strip query string for routing; the iframe HTML reads its own search
    // params from window.location.
    const path = url.split('?')[0] ?? '/';
    if (path === '/iframe.html' || path === '/' || path === '/embed/swap') {
      sendFile(res, iframeHtml, 'text/html; charset=utf-8');
      return;
    }
    if (path === '/penpal.min.js') {
      sendFile(res, penpal, 'application/javascript; charset=utf-8');
      return;
    }
    if (path === '/sdk.js') {
      sendFile(res, sdk, 'application/javascript; charset=utf-8');
      return;
    }
    send404(res, url);
  };
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address || typeof address.port !== 'number') {
        rejectListen(new Error('Server did not bind to an ephemeral port'));
        return;
      }
      resolveListen(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose());
  });
}

/**
 * Start both servers and return their origins. The caller is responsible
 * for invoking the returned `close()` to free the ports.
 */
export async function startServers(): Promise<RunningServers> {
  const hostServer = createServer(makeHostHandler());
  const iframeServer = createServer(makeIframeHandler());

  const [hostPort, iframePort] = await Promise.all([
    listen(hostServer),
    listen(iframeServer),
  ]);

  return {
    hostOrigin: `http://127.0.0.1:${hostPort}`,
    iframeOrigin: `http://127.0.0.1:${iframePort}`,
    async close() {
      await Promise.all([closeServer(hostServer), closeServer(iframeServer)]);
    },
  };
}
