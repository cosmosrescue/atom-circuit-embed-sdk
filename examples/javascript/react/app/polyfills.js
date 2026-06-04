// cosmos-kit's wallet adapters reference the global Buffer at module-eval time,
// which the browser does not provide. Installing it here and importing this
// module first in main.jsx makes it available before the example modules load.
// Only the parent-wallet-cosmoskit example needs this; it is harmless for the
// others. The buffer/process/stream aliases live in vite.config.js.
import { Buffer } from 'buffer';

globalThis.Buffer = globalThis.Buffer || Buffer;
