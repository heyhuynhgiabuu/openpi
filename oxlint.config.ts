import { defineConfig } from 'oxlint'

export default defineConfig({
  ignorePatterns: [
    // Vendored anti-slop plugin source — linted and tested upstream, not here.
    'tools/oxlint/anti-slop/**',
    // Agent/tooling assets (per anti-slop vendoring guidance).
    '.agent/**',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.continue/**',
    '.cursor/**',
    '.gemini/**',
    '.opencode/**',
    '.pi/**',
    '.roo/**',
    '.windsurf/**',
    // Build outputs (carried over from the Biome files config).
    'out/**',
    'coverage/**',
    'release/**',
    'dist/**',
  ],
  plugins: ['jsx-a11y'],
  categories: {
    // Biome `recommended` intent: outright-wrong code is an error.
    correctness: 'error',
  },
  rules: {
    // Biome carry-overs (warn-level in biome.json). JSX-a11y rules mapped to
    // oxlint's jsx-a11y plugin; Biome noSvgWithoutTitle/useSemanticElements
    // have no oxlint equivalent (prefer-tag-over-role is the closest). Keep
    // these warn-level so they inform without failing CI.
    'no-unused-vars': 'warn',
    'typescript/no-explicit-any': 'warn',
    'typescript/no-non-null-assertion': 'off',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/no-redundant-roles': 'warn',
    'jsx-a11y/role-supports-aria-props': 'warn',
    'jsx-a11y/aria-proptypes': 'warn',
    'jsx-a11y/interactive-supports-focus': 'warn',
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
    'jsx-a11y/prefer-tag-over-role': 'warn',
    // Solid templates use the HTML `for` attribute (not React's `htmlFor`),
    // which label/control association rules do not resolve — they flag every
    // correctly-associated label. Revisit if the plugin learns `for`.
    'jsx-a11y/label-has-associated-control': 'off',
    'jsx-a11y/control-has-associated-label': 'off',
    // Solid idiom: refs are declared `let el!: HTMLElement` (or `| undefined`)
    // and assigned by the framework through `ref={}` callbacks. The rule reads
    // that as never-assigned; it cannot see framework assignment.
    'no-unassigned-vars': 'off',

    // Vendored anti-slop plugin — see tools/oxlint/anti-slop/.
    // Staged rollout: rules already clean (or fixed to zero) enforce as errors;
    // rules with a large legacy backlog enforce as warnings to ratchet later
    // (backlog counts are re-derivable from `npx oxlint` output).
    'anti-slop/no-chained-type-assertions': 'warn',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'warn',
    'anti-slop/no-module-mocking': 'off', // tests mock Electron IPC/window seams with vi.mock by design
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'warn',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'warn',
    'anti-slop/no-unknown-returns': 'warn',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'warn',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'warn',
  },
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
})
