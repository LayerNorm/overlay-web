import { defineConfig, globalIgnores } from "eslint/config";
import { fixupPluginRules } from "@eslint/compat";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Patch eslint-plugin-react and eslint-plugin-react-hooks in-place before
// eslint-config-next imports them. ESLint v10 removed context.getFilename()
// which these plugins still use. fixupPluginRules restores the deprecated
// context methods so the plugins work under ESLint v10.
const patchedReact = fixupPluginRules(reactPlugin);
const patchedReactHooks = fixupPluginRules(reactHooksPlugin);
// Mutate the original module exports so eslint-config-next picks up the fixup.
for (const key of Object.keys(patchedReact)) {
  reactPlugin[key] = patchedReact[key];
}
for (const key of Object.keys(patchedReactHooks)) {
  reactHooksPlugin[key] = patchedReactHooks[key];
}

const nextVitals = (await import("eslint-config-next/core-web-vitals")).default;
const nextTs = (await import("eslint-config-next/typescript")).default;
const { createArchitectureBoundaryConfigs } = await import("./scripts/eslint-boundary-rules.mjs");

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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  sharedIsomorphicRules,
  serverGuardrailRules,
  ...createArchitectureBoundaryConfigs(),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "overlay-desktop/**",
    "overlay-chrome/dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
