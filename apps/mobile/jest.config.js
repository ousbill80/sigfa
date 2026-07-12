/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: [
    // Re-apply react-native jest setup from mobile's LOCAL node_modules (react@18 path).
    // Needed because jest-expo's preset resolves react-native from .pnpm/node_modules/react-native
    // which points to the react@19 variation — so its NativeModules mock applies to the
    // react@19 path, not the react@18 path used by mobile tests. Running the react@18 setup
    // AFTER ensures the correct NativeModules module is also mocked.
    require.resolve('./node_modules/react-native/jest/setup.js'),
    './jest.setup.js',
  ],
  // setupFilesAfterEnv runs after the test framework is installed,
  // allowing use of global test hooks (afterEach, beforeEach, etc.).
  setupFilesAfterEnv: ['./jest.setup.afterFramework.js'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!src/index.ts',
    '!src/index.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  moduleNameMapper: {
    // Restore runtime react mapping — tsconfig paths entries for react point to @types/react
    // (for tsc isolation) but jest must resolve to the actual react runtime package.
    '^react$': '<rootDir>/node_modules/react/index.js',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime.js',
    '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime.js',
    // Fix: pnpm dual-react-version — jest-expo preset loads from react-native@react@19 variant
    // in .pnpm/node_modules; mobile tests use react-native@react@18 variant. Redirect ALL
    // react-native NativeModules to a unified mock so the same mock applies in both variants.
    'react-native/Libraries/BatchedBridge/NativeModules': '<rootDir>/__mocks__/NativeModules.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@sigfa/schemas$': '<rootDir>/../../packages/schemas/src/index.ts',
    // @sigfa/contracts : createSigfaClient vit dans client.ts. On mappe la
    // SOURCE (pas dist/, ESM "type: module" que jest CJS refuse ; pas index.ts,
    // qui porte import.meta). Même logique que l'alias vitest du kiosk.
    '^@sigfa/contracts$': '<rootDir>/../../packages/contracts/src/client.ts',
  },
  transformIgnorePatterns: [
    // pnpm-compatible: two-pattern approach
    // Pattern 1: for pnpm's .pnpm store - allow through @react-native+* packages (they use Flow syntax)
    'node_modules/.pnpm/(?!(@react-native\\+|react-native@|expo@|expo-|@expo|jest-expo|i18n-js|nanoid))',
    // Pattern 2: for regular node_modules (non-.pnpm) - allow through react-native/expo/etc.
    'node_modules/(?!\\.pnpm|((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|i18n-js|nanoid))',
  ],
};
