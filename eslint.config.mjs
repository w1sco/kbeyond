import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Benutzte, aber nicht importierte Bezeichner sollen auffallen.
    //
    // Genau daran ist die Ligaseite live gestorben: Eine Textersetzung an der
    // Import-Zeile griff nicht, die Seite benutzte fünf Funktionen ohne
    // Import. JavaScript merkt das erst beim Aufruf, der Build lief also
    // durch — und die Seite antwortete mit einem Serverfehler.
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      globals: {
        // Was in Next-Code an globalen Namen normal ist
        fetch: "readonly", Response: "readonly", Request: "readonly",
        URL: "readonly", URLSearchParams: "readonly", Headers: "readonly",
        ReadableStream: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
        AbortController: "readonly", console: "readonly", process: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        document: "readonly", window: "readonly", localStorage: "readonly",
        matchMedia: "readonly", getComputedStyle: "readonly",
        Intl: "readonly", React: "readonly",
      },
    },
    rules: {
      "no-undef": "error",

      // Verwendung vor der Definition. no-undef sieht das nicht — die
      // Variable existiert ja, nur später. In einer async-Serverkomponente
      // heißt das: Build grün, Seite tot. Genau so ist die Managerseite
      // ausgefallen, weil eine Zeile die Posten las, bevor sie berechnet
      // waren.
      "no-use-before-define": ["error", { functions: false, classes: false, variables: true }],
    },
  },

  {
    // Der Prüfstand ist ein Node-Skript, kein Next-Code: er läuft über
    // `node pruefstand/seiten.js` und lädt seine Abhängigkeiten mit
    // require. Die Modulregeln der App gelten hier nicht.
    files: ["pruefstand/**/*.js", "pruefstand/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
