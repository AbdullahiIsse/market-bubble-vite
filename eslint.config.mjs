import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', 'design-reference/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // react-hooks v7 'recommended' includes the compiler-derived rules
    // (set-state-in-effect etc.) on top of the classic two.
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { files: ['src/**', 'components/**', 'hooks/**'], languageOptions: { globals: { ...globals.browser } } },
  {
    files: ['server/**', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    // protocol adapters match control chars on purpose (IRC CTCP \x01 frames)
    rules: { 'no-control-regex': 'off' },
  },
]);
