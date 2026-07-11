// __tests__/mob-001-phone-otp-flow.test.tsx
// MOB-001: PhoneScreen OTP flow — étape 2 avec saisie OTP
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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
    fireEvent.changeText(getByTestId('phone-input'), '+2250102030405');
    fireEvent(getByTestId('uemoa-switch'), 'valueChange', true);

    // Envoyer OTP
    await waitFor(() => {
      const button = getByTestId('send-otp-button');
      expect(button.props.accessibilityState?.disabled).toBeFalsy();
    });
    fireEvent.press(getByTestId('send-otp-button'));

    // Étape 2: saisir le code OTP
    await waitFor(() => {
      expect(queryByTestId('otp-input')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('otp-input'), '123456');
    fireEvent.press(getByTestId('verify-otp-button'));

    // Vérification de la navigation
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)');
    });
  });
});
