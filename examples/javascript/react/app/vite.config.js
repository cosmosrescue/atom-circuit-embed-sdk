import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The parent-wallet-cosmoskit example pulls in cosmos-kit and its wallet
// adapters, which reference the Node globals Buffer, process, and stream at
// module-eval time. Vite does not polyfill those, so these aliases and defines
// are required for that example to run (Buffer is also installed as a global in
// polyfills.js, imported first in main.jsx). The minimal, full, and
// parent-wallet examples do not need any of this, but one app runs all four.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
      stream: require.resolve('stream-browserify'),
    },
  },
  define: {
    'process.env': {},
    'process.browser': true,
    'process.version': JSON.stringify('v20.0.0'),
    global: 'globalThis',
  },
});
