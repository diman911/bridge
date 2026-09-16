import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'node_modules/**',
      // The flat config itself: type-aware rules need a TS project, and this
      // file isn't in one (and defines it — chicken-and-egg). Prettier still
      // formats it.
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // recommendedTypeChecked enables type-checked rules for every file, but
  // parserOptions.project is only set for *.ts below. Plain JS/MJS files
  // would crash with "used a rule which requires type information" —
  // disableTypeChecked turns the typed rules off for them (canonical
  // typescript-eslint fix for linting JS alongside TS).
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Type-aware linting for TS files only, and Node globals — this repo's
  // default runtime is Node/Workers, not the browser (unlike the chrome
  // extension's eslint config, which this one is modeled on).
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  // Honor the codebase's `^_` convention for intentionally-unused bindings
  // (e.g. `_signal` params, `_` discard slots). no-unused-vars stays on for
  // real dead code — this only silences deliberately-underscored names.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Tests run under Node (vitest) — relax rules that conflict with test
  // idioms. no-explicit-any alone is not enough: recommendedTypeChecked also
  // enables the no-unsafe-* family, which fires on every *use* of an
  // already-`any` value (tests have many `as any` / mock shapes — each
  // downstream use would light up).
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  prettier,
];
