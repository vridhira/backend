// @ts-check
module.exports = {
  extends: [
    "plugin:@typescript-eslint/recommended"
  ],
  plugins: [
    "security",
    "@typescript-eslint",
    "no-secrets"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module"
  },
  rules: {

    // ── Cryptography & Randomness ─────────────────────────────
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message: "Math.random() is not cryptographically secure. Use crypto.randomInt() or crypto.randomBytes() instead."
      },
      {
        selector: "CallExpression[callee.property.name='log'][arguments.0.type='TemplateLiteral']",
        message: "Avoid console.log with template literals — may accidentally log secrets. Use structured logging."
      }
    ],

    // ── Dangerous Eval & Code Injection ──────────────────────
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-non-literal-regexp": "warn",
    "security/detect-non-literal-fs-filename": "warn",
    "security/detect-non-literal-require": "error",

    // ── Object Injection ──────────────────────────────────────
    "security/detect-object-injection": "warn",

    // ── Buffer Issues ─────────────────────────────────────────
    "security/detect-buffer-noassert": "error",

    // ── Regex DoS (ReDoS) ─────────────────────────────────────
    "security/detect-unsafe-regex": "error",

    // ── Child Process ─────────────────────────────────────────
    "security/detect-child-process": "error",

    // ── TypeScript Strictness ─────────────────────────────────
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-floating-promises": "error",

    // ── Secrets Detection ─────────────────────────────────────
    "no-secrets/no-secrets": ["error", {
      tolerance: 4.2,
      additionalDelimiters: ["=", ":"]
    }],

    // ── Custom Vridhira Security Rules ────────────────────────

    // Never use == for comparisons (use === always)
    "eqeqeq": ["error", "always"],

    // No console in production code (use logger)
    "no-console": ["warn", { allow: ["error"] }],

    // Prevent prototype pollution patterns
    "security/detect-possible-timing-attacks": "error",

    // Disallow deprecated crypto methods
    "no-restricted-properties": [
      "error",
      {
        object: "crypto",
        property: "createCipher",
        message: "crypto.createCipher is deprecated and insecure. Use crypto.createCipheriv with a random IV."
      },
      {
        object: "crypto",
        property: "createDecipher",
        message: "crypto.createDecipher is deprecated and insecure. Use crypto.createDecipheriv."
      }
    ]
  },

  overrides: [
    {
      // Extra strictness on webhook handlers
      files: ["src/api/hooks/**/*.ts"],
      rules: {
        "no-console": "error",
        "@typescript-eslint/no-explicit-any": "error"
      }
    },
    {
      // Extra strictness on payment module
      files: ["src/modules/cod-payment/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "security/detect-possible-timing-attacks": "error"
      }
    },
    {
      // Relax rules in tests
      files: ["*.test.ts", "*.spec.ts"],
      rules: {
        "no-console": "off",
        "no-secrets/no-secrets": "off"
      }
    }
  ],

  ignorePatterns: [
    "node_modules/",
    "dist/",
    ".medusa/",
    "*.js"
  ]
};
