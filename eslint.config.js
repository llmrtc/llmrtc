import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/',
      '**/coverage/',
      '**/node_modules/',
      'docs/build/',
      'docs/.docusaurus/',
      'playwright-report/',
      'test-results/',
      '.npm-cache/',
      '**/*.min.js'
    ]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    // Tests, e2e specs, and examples routinely use `any` for mocks and fixtures.
    files: ['**/tests/**', 'e2e/**', 'examples/**', '**/test-utils.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  }
];
