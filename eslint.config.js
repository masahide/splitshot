// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  // 無視
  { ignores: ["dist/**", "node_modules/**"] },

  // JS 推奨
  js.configs.recommended,

  // TS 推奨（型非依存。型チェックは tsc に任せる方針）
  ...tseslint.configs.recommended,

  // 環境
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node, // Node ランタイム
      },
    },
  },

  // Prettier で競合ルールを OFF
  prettier,
];
