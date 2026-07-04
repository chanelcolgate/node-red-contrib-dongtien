import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "no-this-alias": "off",
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*/{ts,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-this-alias": "off",
      "@typescript-eslint/no-explici-any": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  prettier,
]);
