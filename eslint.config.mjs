// eslint-config-next@16 ships native flat-config arrays — no FlatCompat needed.
// The old FlatCompat.extends() path triggered a circular-JSON crash in ESLint 9
// when the React plugin validated its schema, breaking Vercel builds.
import nextConfig from 'eslint-config-next';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default eslintConfig;
