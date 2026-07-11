// __tests__/mob-001-phone-otp-flow.test.tsx
// MOB-001: PhoneScreen OTP flow — étape 2 avec saisie OTP
import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import PhoneScreen from '../app/(auth)/phone';

import { requestOtp, verifyOtp } from '../src/services/auth';

jest.mock('../src/services/auth', () => ({
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Slot: 'Slot',
  Redirect: jest.fn(() => null),
}));

const mockRequestOtp = requestOtp as jest.MockedFunction<typeof requestOtp>;
const mockVerifyOtp = verifyOtp as jest.MockedFunction<typeof verifyOtp>;

describe('MOB-001: PhoneScreen OTP flow — étape 2 avec saisie OTP', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockRequestOtp.mockResolvedValue(undefined);
    mockVerifyOtp.mockResolvedValue(true);
  });

  test('flux complet : téléphone → OTP → authentifié', async () => {
    const { getByTestId, queryByTestId } = render(<PhoneScreen />);

    // Étape 1: saisir le numéro et activer UEMOA
    await act(async () => {
      fireEvent.changeText(getByTestId('phone-input'), '+2250102030405');
      fireEvent(getByTestId('uemoa-switch'), 'valueChange', true);
    });

    // Le bouton send-otp-button doit être activé (uemoa=true, not loading)
    await waitFor(
      () => {
        const button = getByTestId('send-otp-button');
        expect(button.props.accessibilityState?.disabled).toBeFalsy();
      },
      { timeout: 3000 },
    );

    // Envoyer OTP — l'appel à requestOtp() est une promesse résolue immédiatement
    await act(async () => {
      fireEvent.press(getByTestId('send-otp-button'));
    });

    // Étape 2: attendre l'apparition du champ OTP (step passe à 'otp' après await sendOtp())
    await waitFor(
      () => {
        expect(queryByTestId('otp-input')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // Saisir le code OTP et valider
    await act(async () => {
      fireEvent.changeText(getByTestId('otp-input'), '123456');
      fireEvent.press(getByTestId('verify-otp-button'));
    });

    // Vérification de la navigation après verifyOtp() résolu
    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledWith('/(app)');
      },
      { timeout: 3000 },
    );
  });
});
