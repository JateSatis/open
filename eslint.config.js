// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // Edge Functions живут в Deno со своими импортами и своим deno lint.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
]);
