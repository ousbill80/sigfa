// jest.setup.js — MOB-001
// Mocks globaux pour les modules natifs non disponibles en environnement de test

// Mock expo-localization
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'fr', languageTag: 'fr-FR', regionCode: 'FR' }],
  locale: 'fr-FR',
  locales: [{ languageCode: 'fr', languageTag: 'fr-FR', regionCode: 'FR' }],
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));

// Mock react-native-mmkv (recrypt requis par le gate S8 — secure-storage.ts)
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(() => undefined),
    delete: jest.fn(),
    contains: jest.fn(() => false),
    recrypt: jest.fn(),
  })),
}));

// Mock expo-secure-store (S8) — trousseau en mémoire
jest.mock('expo-secure-store', () => {
  const secureStore = {};
  return {
    getItemAsync: jest.fn((key) => Promise.resolve(secureStore[key] ?? null)),
    setItemAsync: jest.fn((key, value) => {
      secureStore[key] = value;
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      delete secureStore[key];
      return Promise.resolve();
    }),
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  };
});

// Mock expo-crypto (S8) — aléa déterministe pour les tests
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn((count) =>
    Promise.resolve(Uint8Array.from({ length: count }, (_, i) => (i * 31 + 7) % 256))
  ),
}));

// Mock expo-router — Stack must be a valid React component (not a plain object)
jest.mock('expo-router', () => {
  const React = require('react');

  function StackMock({ children }) {
    return React.createElement(React.Fragment, null, children);
  }
  StackMock.Screen = function StackScreen() { return null; };

  return {
    useRouter: jest.fn(() => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
    })),
    useLocalSearchParams: jest.fn(() => ({})),
    Link: 'Link',
    Stack: StackMock,
    Slot: function Slot() { return null; },
    Redirect: jest.fn(() => null),
  };
});
