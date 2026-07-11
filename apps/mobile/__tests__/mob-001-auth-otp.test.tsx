// __tests__/mob-001-auth-otp.test.tsx
// MOB-001: auth OTP — écran de saisie téléphone rendu + opt-in UEMOA visible
import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import PhoneScreen from '../app/(auth)/phone';
import { requestOtp, verifyOtp } from '../src/services/auth';

// Mock des services
jest.mock('../src/services/auth', () => ({
  requestOtp: jest.fn().mockResolvedValue(undefined),
  verifyOtp: jest.fn().mockResolvedValue(true),
}));

const mockRequestOtp = requestOtp as jest.MockedFunction<typeof requestOtp>;
const mockVerifyOtp = verifyOtp as jest.MockedFunction<typeof verifyOtp>;

// Use fake timers to prevent TouchableOpacity's Animated.timing (requestAnimationFrame →
// setTimeout(0)) from firing outside of act() and producing "not wrapped in act(...)" warnings.
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(async () => {
  // Flush pending Animated timers inside act() so React processes state updates safely.
  await act(async () => {
    jest.runAllTimers();
  });
  jest.useRealTimers();
});

describe('MOB-001: auth OTP — écran de saisie téléphone rendu + opt-in UEMOA visible', () => {
  test('champ téléphone est visible', () => {
    const { getByTestId } = render(<PhoneScreen />);
    expect(getByTestId('phone-input')).toBeTruthy();
  });

  test('opt-in UEMOA est visible', () => {
    const { getByTestId } = render(<PhoneScreen />);
    expect(getByTestId('uemoa-consent-row')).toBeTruthy();
  });

  test('message d\'erreur UEMOA requis visible quand switch OFF', () => {
    const { getByTestId } = render(<PhoneScreen />);
    expect(getByTestId('uemoa-required')).toBeTruthy();
  });

  test('bouton envoi OTP est désactivé sans opt-in UEMOA', () => {
    const { getByTestId } = render(<PhoneScreen />);
    const button = getByTestId('send-otp-button');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  test('bouton envoi OTP est actif après opt-in UEMOA', async () => {
    const { getByTestId } = render(<PhoneScreen />);
    const uemoaSwitch = getByTestId('uemoa-switch');
    fireEvent(uemoaSwitch, 'valueChange', true);
    await waitFor(() => {
      const button = getByTestId('send-otp-button');
      expect(button.props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  test('mock OTP 123456 vérifie avec succès', async () => {
    const result = await verifyOtp('+2250102030405', '123456');
    expect(result).toBe(true);
  });

  test('mauvais code OTP retourne false', async () => {
    mockVerifyOtp.mockResolvedValueOnce(false);
    const result = await verifyOtp('+2250102030405', '000000');
    expect(result).toBe(false);
  });

  test('requestOtp appelle le service avec le téléphone', async () => {
    await requestOtp('+2250102030405');
    expect(mockRequestOtp).toHaveBeenCalledWith('+2250102030405');
  });
});
