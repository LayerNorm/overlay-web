import { defineConfig, globalIgnores } from "eslint/config";
import { fixupPluginRules } from "@eslint/compat";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Patch eslint-plugin-react-hooks before eslint-config-next imports it.
// ESLint v10 removed context.getFilename(), which this plugin still uses.
const patchedReactHooks = fixupPluginRules(reactHooksPlugin);
for (const key of Object.keys(patchedReactHooks)) {
  reactHooksPlugin[key] = patchedReactHooks[key];
}

const nextVitals = (await import("eslint-config-next/core-web-vitals")).default.map((config) => {
  if (!config.plugins?.["react-hooks"]) return config;

  return {
    ...config,
    plugins: { ...config.plugins, "react-hooks": reactHooksPlugin },
    rules: { ...config.rules, ...reactHooksPlugin.configs.recommended.rules },
  };
});
const nextTs = (await import("eslint-config-next/typescript")).default;
const { createArchitectureBoundaryConfigs } = await import("./scripts/ci/eslint-boundary-rules.mjs");

const sharedIsomorphicRules = {
  files: ["src/shared/**/*.ts", "src/shared/**/*.tsx"],
  ignores: ["src/shared/**/*.test.ts", "src/shared/env/public-env.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/server", "@/server/*"],
            message: "src/shared must not import server-only code.",
          },
          {
            group: [
              "@/features",
              "@/features/*",
              "@/components",
              "@/components/*",
              "@/app",
              "@/app/*",
              "@/hooks",
              "@/hooks/*",
              "@/contexts",
              "@/contexts/*",
            ],
            message: "src/shared must only import other @/shared modules.",
          },
          {
            group: ["node:*"],
            message: "No Node builtins in src/shared (use src/server).",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message:
          "Do not read process.env in src/shared; use @/shared/env/public-env.",
      },
    ],
  },
};

const serverGuardrailRules = {
  files: [
    "src/server/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    "src/app/api/**/*.{ts,tsx,js,jsx,mjs,cjs}",
  ],
  ignores: ["src/server/**/*.test.ts", "src/server/observability/logger.ts"],
  rules: {
    "no-console": "error",
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/server/tools/internal-api-secret",
            message:
              "Import getInternalApiSecret from @/server/shared/internal-api-secret.",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "CatchClause[param=null]",
        message:
          "Server catch blocks must bind the error. Log it, handle it, or name it _error for an intentional ignore.",
      },
      {
        selector:
          "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0]",
        message:
          "Promise catch handlers in server code must accept the error. Log it, handle it, or name it _error for an intentional ignore.",
      },
    ],
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
        varsIgnorePattern: "^_",
      },
    ],
  },
};


const rawInteractiveControlRules = {
  files: [
    "src/**/*.{tsx,jsx}",
    "packages/overlay-chat-react/src/**/*.{tsx,jsx}",
    "packages/overlay-modules-react/src/**/*.{tsx,jsx}",
  ],
  ignores: [
    "**/*.test.{tsx,jsx}",
    "**/*.spec.{tsx,jsx}",
    "**/*.stories.{tsx,jsx}",
    "**/fixtures/**",
    "**/__fixtures__/**",
    "**/__mocks__/**",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXOpeningElement[name.name='button']",
        message: "Use @overlay/ui Button instead of a raw <button>.",
      },
      {
        selector: "JSXOpeningElement[name.name='input']",
        message: "Use @overlay/ui Input instead of a raw <input>. Browser-semantics exceptions need an overlay:raw-control comment with the reason and an adjacent ESLint suppression.",
      },
      {
        selector: "JSXOpeningElement[name.name='textarea']",
        message: "Use @overlay/ui Textarea instead of a raw <textarea>.",
      },
      {
        selector: "JSXOpeningElement[name.name='select']",
        message: "Use @overlay/ui Select instead of a raw <select>.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  sharedIsomorphicRules,
  serverGuardrailRules,
  rawInteractiveControlRules,
  ...createArchitectureBoundaryConfigs(),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "apps/**",
    "overlay-desktop/**",
    "overlay-chrome/dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
