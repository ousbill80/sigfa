// __tests__/mob-001-navigation.test.tsx
// MOB-001: Expo Router v3 — navigation entre 3 routes typées sans crash (Jest + RNTL)
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Test de rendu des 3 layouts principaux sans crash
import RootLayout from '../app/_layout';
import AuthLayout from '../app/(auth)/_layout';
import AppLayout from '../app/(app)/_layout';
import PhoneScreen from '../app/(auth)/phone';
import HomeScreen from '../app/(app)/index';
import Step1Screen from '../app/(app)/new-ticket/step-1';

describe('MOB-001: Expo Router v3 — navigation entre 3 routes typées sans crash', () => {
  test('RootLayout se rend sans crash', async () => {
    // S8 : le root layout gate le rendu derrière initSecureStorage() (async) —
    // on attend la résolution du gate pour un rendu stable (pas d'update hors act).
    const { queryByTestId } = render(<RootLayout />);
    await waitFor(() => {
      expect(queryByTestId('secure-storage-gate')).toBeNull();
    });
  });

  test('AuthLayout se rend sans crash', () => {
    expect(() => render(<AuthLayout />)).not.toThrow();
  });

  test('AppLayout se rend sans crash', () => {
    expect(() => render(<AppLayout />)).not.toThrow();
  });

  test('PhoneScreen se rend sans crash', () => {
    expect(() => render(<PhoneScreen />)).not.toThrow();
  });

  test('HomeScreen se rend sans crash', () => {
    expect(() => render(<HomeScreen />)).not.toThrow();
  });

  test('Step1Screen se rend sans crash', () => {
    expect(() => render(<Step1Screen />)).not.toThrow();
  });
});
