import js from '@eslint/js';
import ts from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    ignores: ['dist', 'coverage', '**/node_modules']
  },
  {
    rules: {
      'no-console': 'off'
    }
  }
];
