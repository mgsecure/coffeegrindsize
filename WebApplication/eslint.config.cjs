const {
    defineConfig,
    globalIgnores,
} = require('eslint/config')

const globals = require('globals')
const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')
const _import = require('eslint-plugin-import')

const {
    fixupPluginRules,
    fixupConfigRules,
} = require('@eslint/compat')

const js = require('@eslint/js')

const {
    FlatCompat,
} = require('@eslint/eslintrc')

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
})

module.exports = defineConfig([{
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
        globals: {
            ...globals.browser,
            ...globals.node,
        },

        ecmaVersion: 'latest',
        sourceType: 'module',

        parserOptions: {
            ecmaFeatures: {
                jsx: true,
            },
        },
    },

    plugins: {
        react: fixupPluginRules(react),
        'react-hooks': fixupPluginRules(reactHooks),
        import: fixupPluginRules(_import),
    },

    extends: fixupConfigRules(compat.extends(
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:import/recommended',
    )),

    settings: {
        react: {
            version: 'detect',
        },
    },

    rules: {
        'react/prop-types': 'off',

        'no-unused-vars': ['warn', {
            'ignoreRestSiblings': true,
            'args': 'all',
            'argsIgnorePattern': '^_',
            'varsIgnorePattern': '^_',
            'destructuredArrayIgnorePattern': '^_',
            'caughtErrors': 'all',
            'caughtErrorsIgnorePattern': '^_'
        }],

        'react-hooks/exhaustive-deps': 'warn',

        'quotes': ['warn', 'single', {
            'avoidEscape': true,
        }],

        'eqeqeq': ['warn', 'always'],
        'semi': ['warn', 'never'],

        'import/extensions': ['warn', 'never', {
            jsx: 'never',
            json: 'always',
            js: 'ignorePackages'

        }],

        'import/no-unresolved': 'off',
        'import/namespace': 'off',
    },
}, globalIgnores([
    '**/dist',
    '**/client-dist',
    '**/build',
    '**/node_modules',
    '**/*.log',
    '**/*.md',
    '**/*.png',
    '**/*.gif',
    '**/*.csv',
    '**/*.html',
    '**/*.json',
    '**/*.css',
])])
