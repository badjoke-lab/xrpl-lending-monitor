import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.d1-tools-build/**',
      '.artifact-measurement-build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.wrangler/**',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/worker/**/*.ts', 'src/shared/current-state/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.worker,
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/worker/repositories/current-state-overlay.test.ts'],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
  {
    files: ['*.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['scripts/manage-r5-terminal-archive-phase-b-tranche.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          // createdAt participates in tranche ordering/authorization but the compact
          // terminal archive intentionally does not persist it, so post-apply identity
          // verification destructures it away before comparing archived rows.
          varsIgnorePattern: '^(_|createdAt$)',
        },
      ],
    },
  },
  {
    files: ['scripts/verify-supabase-r5-first-recovery-batch.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^(_|requiredNumber$)',
        },
      ],
    },
  },
  {
    files: ['scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs'],
    rules: {
      // The stopped-cycle assignment preserves the exact final adoption snapshot
      // consumed by the final parity check after the loop exits.
      'no-useless-assignment': 'off',
    },
  },
)