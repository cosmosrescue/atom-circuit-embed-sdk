/**
 * Cross-origin handshake integration test for the Atom Circuit Embed SDK.
 *
 * The test plan: "One Playwright integration test for
 * cross-origin handshake (happy path only)." This file is that test.
 *
 * Topology:
 *
 *   ┌───────────────────────────┐       ┌──────────────────────────────┐
 *   │ Host page                 │       │ Mock dapp iframe             │
 *   │ origin: 127.0.0.1:<A>     │  <->  │ origin: 127.0.0.1:<B>        │
 *   │ loads SDK IIFE, calls     │       │ runs real Penpal handshake,  │
 *   │ AtomCircuit.mount(...)    │       │ posts ready / swap events    │
 *   └───────────────────────────┘       └──────────────────────────────┘
 *
 * Two distinct ports on 127.0.0.1 give us a real cross-origin boundary as
 * far as the browser's postMessage origin check is concerned, with no DNS
 * or TLS provisioning. Both servers are spun up in `beforeAll` and torn
 * down in `afterAll`.
 *
 * The unit tests (test/iframe-client.test.ts, test/mount.test.ts) already
 * cover the edge cases (origin mismatch rejection, malformed payload
 * rejection, handshake timeout, destroy idempotency). This file only
 * exercises the happy path: SDK mounts, iframe loads, handshake completes,
 * swap:submitted reaches the host, swap:success reaches the host, destroy
 * cleans up.
 */

import { test, expect } from '@playwright/test';

import { startServers, type RunningServers } from './server.js';

let servers: RunningServers;

test.beforeAll(async () => {
  servers = await startServers();
});

test.afterAll(async () => {
  if (servers) {
    await servers.close();
  }
});

test('cross-origin handshake: ready, swap:submitted, swap:success reach the host', async ({ page }) => {
  // Surface any uncaught page errors so a failing handshake produces a
  // useful trace rather than a generic timeout.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  // Navigate to the host page, passing the iframe origin so it knows where
  // to mount the embed.
  const hostUrl = `${servers.hostOrigin}/?iframeOrigin=${encodeURIComponent(servers.iframeOrigin)}`;
  await page.goto(hostUrl);

  // The SDK is loaded as a cross-origin <script>; wait for it to attach
  // its global. If this never happens, the test below blows up with a
  // clear message rather than a generic timeout.
  await page.waitForFunction(
    () => typeof (window as unknown as { AtomCircuit?: unknown }).AtomCircuit !== 'undefined',
    undefined,
    { timeout: 5_000 }
  );

  // The host's mount() call returns synchronously; verify it created an
  // iframe pointing at the configured origin + path.
  const mountInfo = await page.evaluate(() => {
    const w = window as unknown as { __mountResult?: { hasIframe: boolean; iframeSrc: string | null } };
    return w.__mountResult ?? null;
  });
  expect(mountInfo).not.toBeNull();
  expect(mountInfo!.hasIframe).toBe(true);
  expect(mountInfo!.iframeSrc).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/iframe\.html\?/);
  // The SDK must preserve the host-supplied query (`hostOrigin=...`) AND
  // append its own (`ref`, `v`). Both halves must be present.
  expect(mountInfo!.iframeSrc).toContain('hostOrigin=');
  expect(mountInfo!.iframeSrc).toContain('ref=e2e-test');
  expect(mountInfo!.iframeSrc).toContain(`v=1.0.0`);

  // Wait for the iframe to load, then drive the swap events from inside
  // it. We use frameLocator to address the iframe by its src.
  const iframeFrame = page.frameLocator('iframe[src*="/iframe.html"]');
  await iframeFrame.locator('#state').waitFor({ state: 'attached', timeout: 10_000 });

  // The iframe sets __handshakeSent = true after the Penpal connection
  // resolves and the raw-postMessage handshake is fired. Wait for that.
  await expect
    .poll(
      async () =>
        iframeFrame.locator('body').evaluate(() => {
          const w = window as unknown as { __handshakeSent?: boolean; __handshakeError?: string };
          if (w.__handshakeError) {
            throw new Error('iframe handshake error: ' + w.__handshakeError);
          }
          return Boolean(w.__handshakeSent);
        }),
      { timeout: 15_000, message: 'iframe never reported __handshakeSent' }
    )
    .toBe(true);

  // The SDK's onReady callback fires when the iframe posts the ready
  // event. Wait for the host-side promise the fixture resolves on ready.
  const readyPayload = await page.evaluate(async () => {
    const w = window as unknown as { __readyPromise?: Promise<{ protocolVersion: string }> };
    if (!w.__readyPromise) throw new Error('__readyPromise missing from host page');
    return w.__readyPromise;
  });
  expect(readyPayload).toBeTruthy();
  expect(readyPayload.protocolVersion).toBe('1.0.0');

  // mount() should NOT have surfaced an onError; that would indicate the
  // Penpal half of the handshake failed even though the raw-postMessage
  // half succeeded.
  const mountError = await page.evaluate(() => {
    const w = window as unknown as { __mountError?: { code: string; message: string } | null };
    return w.__mountError ?? null;
  });
  expect(mountError, 'mount() reported an unexpected error: ' + JSON.stringify(mountError)).toBeNull();

  // Trigger swap:submitted from inside the iframe. The SDK should bubble
  // this to the host's onSwapSubmitted callback. We use page.evaluate
  // against the frame's evaluateHandle path via frameLocator -> frame
  // owner. Playwright's frameLocator does not expose `evaluate` directly,
  // so we reach into page.frames() to find the inner frame.
  const innerFrame = page.frames().find((f) => f.url().includes('/iframe.html'));
  expect(innerFrame, 'inner iframe frame missing from page.frames()').toBeDefined();

  const TEST_TX_HASH = '0xC0FFEE0000000000000000000000000000000000000000000000000000000001';

  await innerFrame!.evaluate((txHash) => {
    const w = window as unknown as {
      __emitSwapSubmitted: (p: { txHash: string }) => void;
    };
    w.__emitSwapSubmitted({ txHash });
  }, TEST_TX_HASH);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as unknown as { __swapSubmittedPayload?: { txHash: string } | null };
          return w.__swapSubmittedPayload ?? null;
        }),
      { timeout: 5_000, message: 'host never received swap:submitted' }
    )
    .toMatchObject({ txHash: TEST_TX_HASH });

  // Now trigger swap:success and wait for the host's onSwapSuccess.
  await innerFrame!.evaluate((txHash) => {
    const w = window as unknown as {
      __emitSwapSuccess: (p: { txHash: string }) => void;
    };
    w.__emitSwapSuccess({ txHash });
  }, TEST_TX_HASH);

  const successPayload = await page.evaluate(async () => {
    const w = window as unknown as {
      __swapSuccessPromise?: Promise<{ txHash: string }>;
    };
    if (!w.__swapSuccessPromise) {
      throw new Error('__swapSuccessPromise missing from host page');
    }
    return w.__swapSuccessPromise;
  });
  expect(successPayload.txHash).toBe(TEST_TX_HASH);

  // Verify the event log captured the full sequence in order:
  // ready -> swap:submitted -> swap:success. We allow resize events to
  // appear at any point because the iframe-resize pipeline is timing
  // dependent and not the focus of this test.
  const eventNames = await page.evaluate(() => {
    const w = window as unknown as { __events: Array<{ name: string }> };
    return w.__events.map((e) => e.name).filter((n) => n !== 'resize');
  });
  expect(eventNames[0]).toBe('ready');
  expect(eventNames).toContain('swap:submitted');
  expect(eventNames).toContain('swap:success');
  expect(eventNames.indexOf('swap:submitted')).toBeLessThan(eventNames.indexOf('swap:success'));

  // destroy() must remove the iframe from the DOM and flip the destroyed
  // flag. Calling it twice must not throw (idempotent).
  await page.evaluate(() => {
    const w = window as unknown as { __destroy: () => void };
    w.__destroy();
    w.__destroy();
  });
  const postDestroy = await page.evaluate(() => {
    const w = window as unknown as { __destroyed: boolean };
    const stillMounted = document.querySelector('#container iframe') !== null;
    return { destroyed: w.__destroyed, stillMounted };
  });
  expect(postDestroy.destroyed).toBe(true);
  expect(postDestroy.stillMounted).toBe(false);

  // Final guard: no uncaught page errors during the run.
  expect(pageErrors, 'page emitted uncaught errors: ' + pageErrors.map((e) => e.message).join('; ')).toHaveLength(0);
});
