import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output and runtime scratch space, not maintained source.
    "dist/**",
    "output/**",
    ".sites-runtime/**",
    "public/offline-app/**",
    ".claude/**",
  ]),
  {
    // CommonJS entry points (Passenger launcher, setup and activation helpers) must use require().
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // These rules come with eslint-plugin-react-hooks 6 for code compiled by the React Compiler, which this
    // project does not use. Reviewed one by one on 2026-10-31: every ref read while rendering changes together
    // with a state update, every state set in an effect resets or loads on purpose, and the "immutability"
    // reports are refs the compiler did not recognise. They stay visible as warnings; they are not errors.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // theme-bootstrap.js must set the light or dark class before the first paint (no flash of the wrong theme),
    // and install-bootstrap.js must catch the browser's install prompt that fires before the app loads.
    files: ["app/layout.tsx"],
    rules: {
      "@next/next/no-sync-scripts": "off",
    },
  },
  {
    // A record's data is the JSON its kind stores (lib/crm.ts Row), parsed per kind where it is used; the CRM
    // route mutates the parsed body per kind, and a target set's data differs per kind. Typing these precisely
    // reaches the sales and targets calculations; reviewed 2026-10-31 and left as they are.
    files: ["lib/crm.ts", "lib/targets.ts", "app/api/crm/route.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
