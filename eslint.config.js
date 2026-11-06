import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'cdk.out/**',
      'coverage/**',
      'reports/**',
      '.stryker-tmp/**',
      'node_modules/**',
      'bin/**/*.js',
      'lib/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
      '**/*.d.ts',
      'lib/lambda/favicon-data.ts',
      'paperless.config.json',
      'data.json',
    ],
  },

  // Base recommended rules for every JS/TS file
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // Allow intentionally-unused bindings when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Prettier integration (turns off ESLint rules that might conflict with Prettier)
  prettier
);
