import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

/**
 * Strip duplicate `//# sourceMappingURL=` footer comments emitted by tsup
 * 8.5.1 when `sourcemap: true` is paired with multi-format output. Browsers
 * tolerate the duplicate but Subresource Integrity auditors flag it. Keep
 * only the LAST occurrence (the one tsup intended) so the map reference
 * still points at the right file.
 */
async function stripDuplicateSourceMapFooters(distDir: string): Promise<void> {
  const entries = await readdir(distDir);
  const targets = entries.filter((name) =>
    /\.(js|cjs|mjs)$/.test(name) && !name.endsWith('.map')
  );
  // Match the marker plus everything up to (but not including) the next
  // line terminator. NOT anchored to start-of-line because in the minified
  // IIFE bundle the duplicated comment is appended directly after a
  // closing `})` with no preceding newline. Source-map URL comments are
  // only emitted at the very tail of the file by the bundler, so a stray
  // mid-bundle match would be an unrelated coincidence.
  const linePattern = /\/\/# sourceMappingURL=[^\r\n]*/g;
  for (const name of targets) {
    const path = join(distDir, name);
    const text = await readFile(path, 'utf8');
    const matches = [...text.matchAll(linePattern)];
    if (matches.length < 2) continue;
    // Drop every match except the final one. Walk backwards so earlier
    // match indices stay valid as we splice the string.
    const keepIndex = matches.length - 1;
    let rebuilt = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (i === keepIndex) continue;
      const m = matches[i];
      if (m === undefined || m.index === undefined) continue;
      let start = m.index;
      let end = start + m[0].length;
      // Also consume one trailing newline so we do not leave an empty
      // line behind. If there is no trailing newline (mid-line case, end
      // of file), leave the surrounding bytes intact.
      if (rebuilt[end] === '\r') end++;
      if (rebuilt[end] === '\n') end++;
      rebuilt = rebuilt.slice(0, start) + rebuilt.slice(end);
    }
    await writeFile(path, rebuilt, 'utf8');
  }
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    treeshake: true,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' };
    },
  },
  {
    entry: { react: 'src/react.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    external: ['react', 'react-dom'],
    treeshake: true,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' };
    },
  },
  {
    entry: { 'atom-circuit': 'src/vanilla.ts' },
    format: ['iife'],
    globalName: 'AtomCircuit',
    dts: false,
    // External `.map` rather than inline. Inline source maps would inflate
    // the runtime payload to ~60 KB gzipped, which blows the size budget;
    // shipping the map as a separate file keeps the executed bytes small
    // and still lets operators debug against the bundled source.
    sourcemap: true,
    clean: false,
    target: 'es2020',
    minify: true,
    treeshake: true,
    outExtension() {
      return { js: '.iife.js' };
    },
    async onSuccess() {
      await stripDuplicateSourceMapFooters('dist');
    },
  },
]);
