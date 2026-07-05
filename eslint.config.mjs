import globals from "globals"
import js from "@eslint/js"
import astro from "eslint-plugin-astro"
import typescript from "@typescript-eslint/eslint-plugin"
import parser from "@typescript-eslint/parser"
import astroParser from "astro-eslint-parser"

const overrides = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      varsIgnorePattern: "^_",
      argsIgnorePattern: "^_",
      caughtErrors: "none",
      ignoreRestSiblings: true,
    },
  ],
}

export default [
  {
    ignores: ["dist/*", "public/*", ".astro/*"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      parser: parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      astro,
      "@typescript-eslint": typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      ...astro.configs.recommended.rules,
      ...overrides,
    },
  },
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: parser,
        extraFileExtensions: [".astro"],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        Fragment: "readonly",
      },
    },
    plugins: {
      astro,
      "@typescript-eslint": typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...astro.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      ...overrides,
    },
  },
]
