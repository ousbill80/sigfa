/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
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
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@sigfa/schemas$': '<rootDir>/../../packages/schemas/src/index.ts',
    '^@sigfa/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  transformIgnorePatterns: [
    // pnpm-compatible: two-pattern approach
    // Pattern 1: for pnpm's .pnpm store - allow through @react-native+* packages (they use Flow syntax)
    'node_modules/.pnpm/(?!(@react-native\\+|react-native@|expo@|expo-|@expo|jest-expo|i18n-js|nanoid))',
    // Pattern 2: for regular node_modules (non-.pnpm) - allow through react-native/expo/etc.
    'node_modules/(?!\\.pnpm|((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|i18n-js|nanoid))',
  ],
};
