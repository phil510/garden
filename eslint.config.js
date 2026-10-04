// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

const NODE_BUILTINS = [
  'fs',
  'path',
  'child_process',
  'os',
  'net',
  'http',
  'https',
  'crypto',
  'util',
  'stream',
  'tls',
  'dns',
  'readline',
  'worker_threads',
];

// Patterns, not exact specifiers: `fs`, `node:fs`, `fs/promises` and
// `node:fs/promises` all resolve, so a layer that bans builtins has to cover
// every subpath and both prefixes or the ban is trivially bypassed.
const nodeBuiltinGroup = [
  ...NODE_BUILTINS.flatMap((name) => [name, `${name}/*`]),
  'node:*',
  'node:*/*',
];

/** @param {string} message */
const nodeBuiltinPattern = (message) => ({ group: nodeBuiltinGroup, message });

const adaptersInward = {
  group: ['**/app/**', '**/http/**', '**/cli/**'],
  message:
    'adapters/ may import shared, domain/ types, and its own library only. Adapters emit events; they do not call inward.',
};

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  // The dependency rules from docs/architecture.md, one config block per layer.
  // They are the reason "the core is pure" and "no logic in http/" survive
  // contact with a convenient shortcut. main.ts and config.ts are the
  // composition root, and appdir.ts (the startup file generation main.ts
  // calls) is deliberately unrestricted alongside them.
  //
  // Blocks for directories that do not exist yet are intentional: they fire the
  // moment someone creates the layer.
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            nodeBuiltinPattern(
              'packages/web may import shared only; node builtins, tmux, and the filesystem are server concerns.',
            ),
            {
              group: ['@garden/server', '@garden/server/**'],
              message: 'packages/web must reach garden only through the server HTTP/WS API.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // The hook-correctness rules, not the plugin's whole `recommended` set: that also carries the
    // React Compiler rules, which this codebase's effect-based state resets and render-time
    // `Date.now()` do not satisfy.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/refs': 'error',
    },
  },
  {
    files: ['packages/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            nodeBuiltinPattern(
              'domain/ is pure: no node builtins, no libraries. I/O belongs in adapters/.',
            ),
            {
              group: ['**/adapters/**', '**/app/**', '**/http/**', '**/cli/**'],
              message:
                'domain/ may import shared and other domain/ only. Depending outward is what makes the fold untestable.',
            },
          ],
        },
      ],
    },
  },
  // Two of these blocks are split by directory depth, because the relative form
  // of a cross-adapter import depends on where the importing file sits:
  // `**/adapters/**` only matches specifiers that spell the directory out, so
  // `./git.js` from inside adapters/ needs a relative pattern of its own.
  {
    files: ['packages/server/src/adapters/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            adaptersInward,
            {
              group: ['./*', './*/**', '**/adapters/**'],
              message:
                'adapters/ must not import another adapter. One adapter per external system; compose them in main.ts. An adapter that needs several files becomes a directory, whose files may import each other.',
            },
          ],
        },
      ],
    },
  },
  // A colocated unit test necessarily imports the module it tests, which is a
  // same-directory import the block above would otherwise flag. Only that
  // self-import is justified — a test reaching into a different adapter's
  // module is the same composition-outside-main.ts problem production code
  // has, so the same-directory ban stays for everything except each test's
  // own module. A `.fixture.ts` file is the same case one level removed: it's
  // a child-process entry point a test spawns, importing the one adapter it
  // exercises directly rather than through a temp-dir script.
  {
    files: ['packages/server/src/adapters/*.test.ts', 'packages/server/src/adapters/*.fixture.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            adaptersInward,
            {
              group: [
                './*',
                './*/**',
                '**/adapters/**',
                '!./store.js',
                '!./transcripts.js',
                '!./tmux.js',
                '!./claudeSessions.js',
                '!./fsWatch.js',
                '!./gh.js',
                '!./logger.js',
              ],
              message:
                'adapters/ must not import another adapter. One adapter per external system; compose them in main.ts. An adapter that needs several files becomes a directory, whose files may import each other.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/adapters/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            adaptersInward,
            {
              group: ['../*', '../*/**', '**/adapters/**'],
              message:
                'An adapter directory may import its own files, but not another adapter. One adapter per external system; compose them in main.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/app/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'app/ depends on the ports it declares in app/ports.ts, not on the adapters that satisfy them.',
            },
            {
              group: ['**/http/**'],
              message: 'app/ must not import http/; http/ calls into app/, never the reverse.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/http/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'http/ may import app/ and shared only. Parse the request, call one use case, serialise the result.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/app/**', '**/adapters/**', '**/domain/**'],
              message:
                'cli/ is a thin HTTP client against the local server: shared plus an HTTP client, no business logic.',
            },
          ],
        },
      ],
    },
  },
  // Nothing outside api/ calls fetch: components request through the typed
  // wrappers so every server call has one shape and one place to change.
  // api/ is excluded below, since it's exactly where that call lives.
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    ignores: ['packages/web/src/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Only packages/web/src/api/ calls fetch; components use the typed wrappers.',
        },
      ],
    },
  },
  // Type-aware rules need a tsconfig that includes the file. These are the only
  // ones no tsconfig covers; anything else lints with type information.
  {
    files: ['**/vitest*.config.ts', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.d.ts'],
  },
);
