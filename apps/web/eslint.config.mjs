import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * The structural conventions of `apps/web/CLAUDE.md` that a machine can check, expressed as
 * lint rules rather than prose. A convention that lives only in prose is one an author can
 * silently forget — which is how the duplication these rules forbid accumulated in the first
 * place. Everything not mechanically checkable stays in `apps/web/CLAUDE.md`.
 */
const MODULE_PATHS_USE_THE_ALIAS =
  'Module paths use the `@/` alias: there are no relative imports in `src/`, not even between siblings in one folder. See apps/web/CLAUDE.md.';

const LAYOUT_OWNS_THE_HEADER =
  'The header belongs to the route group layout, not to a file under src/app: `(app)/layout.tsx` renders it through `AppShell` and `(auth)/layout.tsx` through `AuthShell`. See apps/web/CLAUDE.md.';

const FEATURE_FOLDERS_ARE_SEALED =
  'A feature folder is private to its feature: a shared component belongs in `@/components/ui`, shared logic in `@/lib`. See apps/web/CLAUDE.md.';

const ERROR_TEXT_OWNS_THE_CLASS =
  'Render an inline error with `@/components/ui/ErrorText`; the raw `text-sm text-danger` string lives in that one file. See apps/web/CLAUDE.md.';

/**
 * `no-restricted-imports` matches the raw specifier string, not the module it resolves to, so
 * every path-based rule below is blind to the same import written as `../profile/Section`.
 * Banning the relative form outright is what keeps them honest — and it is the `@/`-alias rule
 * of `apps/web/CLAUDE.md` itself, which until now was only a grep an author had to remember.
 * It covers the stylesheet import in the root layout too — nothing in `src/` is exempt, so there
 * is no shape of relative specifier an author has to reason about.
 */
const RELATIVE_IMPORTS_ARE_FORBIDDEN = {
  group: ['.', '..', './*', './**', '../*', '../**'],
  message: MODULE_PATHS_USE_THE_ALIAS,
};

/**
 * Flat config replaces a rule's options wholesale rather than merging them, so a folder-scoped
 * block has to restate the alias rule or it would switch it off for that folder.
 */
const restrictedImports = ({ paths = [], patterns = [] } = {}) => [
  'error',
  { paths, patterns: [RELATIVE_IMPORTS_ARE_FORBIDDEN, ...patterns] },
];

const sealedAgainst = (groups) =>
  restrictedImports({
    patterns: [{ group: groups, message: FEATURE_FOLDERS_ARE_SEALED }],
  });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    name: 'web/module-paths-use-the-alias',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(),
    },
  },
  {
    name: 'web/routes-do-not-render-the-header',
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: [
          {
            name: '@/components/layout/AppHeader',
            message: LAYOUT_OWNS_THE_HEADER,
          },
        ],
      }),
    },
  },
  {
    name: 'web/meetings-does-not-import-profile',
    files: ['src/components/meetings/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': sealedAgainst(['@/components/profile/*']),
    },
  },
  {
    name: 'web/profile-does-not-import-meetings',
    files: ['src/components/profile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': sealedAgainst(['@/components/meetings/*']),
    },
  },
  {
    // `layout/` sits above both features and must not know either of them.
    name: 'web/layout-does-not-import-features',
    files: ['src/components/layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': sealedAgainst([
        '@/components/meetings/*',
        '@/components/profile/*',
      ]),
    },
  },
  {
    // `ui/` is the feature-agnostic layer: it knows about neither feature, and a primitive
    // does not reach back up into the shell that renders it either.
    name: 'web/ui-primitives-know-no-feature',
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': sealedAgainst([
        '@/components/meetings/*',
        '@/components/profile/*',
        '@/components/layout/*',
      ]),
    },
  },
  {
    name: 'web/error-text-owns-the-danger-class',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/ErrorText.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/text-sm text-danger/]',
          message: ERROR_TEXT_OWNS_THE_CLASS,
        },
        {
          selector: 'TemplateElement[value.raw=/text-sm text-danger/]',
          message: ERROR_TEXT_OWNS_THE_CLASS,
        },
      ],
    },
  },
]);

export default eslintConfig;
