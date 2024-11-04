import typescriptEslint from "@typescript-eslint/eslint-plugin";
import stylisticJs from "@stylistic/eslint-plugin-js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [...compat.extends(
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
        "@stylistic/js": stylisticJs,
    },
    
    ignores: ["scripts/*"],

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
        ecmaVersion: 5,
        sourceType: "module",

        parserOptions: {
            project: "tsconfig.json",
        },
    },

    rules: {
        "@stylistic/js/no-multiple-empty-lines": ["error", {
            max: 1,
            maxEOF: 1,
            maxBOF: 0,
        }],

        "@stylistic/js/space-before-blocks": ["error", "always"],

        "@stylistic/js/comma-spacing": ["error", {
            before: false,
            after: true,
        }],

        "@stylistic/js/space-infix-ops": ["error"],
        "@stylistic/js/brace-style": ["error", "stroustrup"],
        "@stylistic/js/key-spacing": ["error"],
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-enum-comparison": "off",
        "@typescript-eslint/adjacent-overload-signatures": "error",

        "@typescript-eslint/array-type": ["error", {
            default: "array",
        }],

        // "@typescript-eslint/ban-types": "error",
        "@typescript-eslint/consistent-type-assertions": "off",
        "@typescript-eslint/consistent-type-definitions": "off",
        "@typescript-eslint/dot-notation": "error",

        "@typescript-eslint/explicit-member-accessibility": ["off", {
            accessibility: "explicit",
        }],

        // "@typescript-eslint/indent": ["error", 4, {
        //     SwitchCase: 1,

        //     FunctionExpression: {
        //         parameters: "off",
        //     },

        //     CallExpression: {
        //         arguments: "off",
        //     },
        // }],

        "@typescript-eslint/member-delimiter-style": "off",
        "@typescript-eslint/member-ordering": "off",
        "@typescript-eslint/naming-convention": "off",
        "@typescript-eslint/no-empty-function": "error",
        "@typescript-eslint/no-empty-interface": "error",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-new": "error",
        "@typescript-eslint/no-namespace": "error",
        "@typescript-eslint/no-parameter-properties": "off",
        "@typescript-eslint/no-unused-expressions": "error",
        "@typescript-eslint/no-use-before-define": "off",
        "@typescript-eslint/no-var-requires": "error",
        "@typescript-eslint/prefer-for-of": "error",
        "@typescript-eslint/prefer-function-type": "error",
        "@typescript-eslint/prefer-namespace-keyword": "error",

        // "@typescript-eslint/quotes": ["error", "double", {
        //     avoidEscape: true,
        // }],

        // "@typescript-eslint/semi": ["error", "always"],

        "@typescript-eslint/triple-slash-reference": ["error", {
            path: "always",
            types: "prefer-import",
            lib: "always",
        }],

        // "@typescript-eslint/type-annotation-spacing": "error",
        "@typescript-eslint/unified-signatures": "error",
        "arrow-body-style": "off",
        "arrow-parens": ["off", "always"],
        "brace-style": ["off", "off"],
        "comma-dangle": "off",
        complexity: "off",
        "constructor-super": "error",
        curly: "error",
        "eol-last": "off",
        eqeqeq: ["off", "always"],
        "guard-for-in": "off",
        "id-blacklist": "off",
        "id-match": "error",
        "max-classes-per-file": ["error", 1],
        "max-len": "off",
        "new-parens": "error",
        "no-bitwise": "error",
        "no-caller": "error",
        "no-cond-assign": "error",
        "no-console": "error",
        "no-debugger": "error",
        "no-empty": "error",
        "no-eval": "error",
        "no-fallthrough": "off",
        "no-invalid-this": "off",
        "no-multiple-empty-lines": "error",
        "no-new-wrappers": "error",
        "no-shadow": "off",
        "no-throw-literal": "error",

        "no-trailing-spaces": ["error", {
            skipBlankLines: true,
        }],

        "no-undef-init": "error",
        "no-underscore-dangle": "off",
        "no-unsafe-finally": "error",
        "no-unused-labels": "error",
        "no-var": "error",
        "object-shorthand": "off",
        "one-var": ["error", "never"],
        "prefer-const": "error",
        "quote-props": "off",
        radix: "error",

        "space-before-function-paren": ["error", {
            anonymous: "never",
            asyncArrow: "always",
            named: "never",
        }],

        "spaced-comment": ["error", "always", {
            markers: ["/"],
            exceptions: ["!"]
        }],

        "use-isnan": "error",
        "valid-typeof": "off",
        "@typescript-eslint/no-shadow": ["error"],
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/no-unsafe-call": "off",

        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
        }],

        "@typescript-eslint/restrict-plus-operands": "off",
        "@typescript-eslint/no-inferrable-types": "off",

        "@typescript-eslint/unbound-method": ["error", {
            ignoreStatic: true,
        }],

        "@typescript-eslint/prefer-regexp-exec": "off",
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
}];