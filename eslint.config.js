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
)
