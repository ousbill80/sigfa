// __tests__/s8-root-layout-gate.test.tsx
// Boucle 2 F4 — S8 : le root layout gate le rendu des écrans derrière
// initSecureStorage() (aucun accès MMKV possible avant chiffrement).
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import RootLayout from '../app/_layout';
import {
  resetSecureStorageForTests,
  isSecureStorageReady,
} from '../src/services/secure-storage';

beforeEach(() => {
  jest.clearAllMocks();
  resetSecureStorageForTests();
});

describe('S8: gate secure storage au boot (app/_layout.tsx)', () => {
  test('S8: affiche le gate loading tant que initSecureStorage() n\'est pas résolue', () => {
    const { getByTestId } = render(<RootLayout />);
    expect(getByTestId('secure-storage-gate')).toBeTruthy();
    expect(isSecureStorageReady()).toBe(false);
  });

  test('S8: monte la navigation une fois les stores chiffrés prêts', async () => {
    const { queryByTestId } = render(<RootLayout />);

    await waitFor(() => {
      expect(queryByTestId('secure-storage-gate')).toBeNull();
    });
    expect(isSecureStorageReady()).toBe(true);
    expect(queryByTestId('secure-storage-error')).toBeNull();
  });

  test('S8: échec du trousseau → état erreur, les écrans ne montent pas', async () => {
    const getItemAsyncMock = SecureStore.getItemAsync as jest.Mock;
    getItemAsyncMock.mockRejectedValueOnce(new Error('keychain indisponible'));

    const { queryByTestId, getByTestId } = render(<RootLayout />);

    await waitFor(() => {
      expect(getByTestId('secure-storage-error')).toBeTruthy();
    });
    expect(isSecureStorageReady()).toBe(false);
    expect(queryByTestId('secure-storage-gate')).toBeNull();
  });
});
