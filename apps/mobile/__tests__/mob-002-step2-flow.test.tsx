// __tests__/mob-002-step2-flow.test.tsx
// MOB-002: Step2 flow — confirmation téléphone + opt-in UEMOA complet
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Step2Screen from '../app/(app)/new-ticket/step-2';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Slot: 'Slot',
  Redirect: jest.fn(() => null),
}));

describe('MOB-002: Step2 flow — confirmation téléphone + opt-in UEMOA complet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
  });

  test('affiche le formulaire de confirmation', () => {
    const { getByTestId } = render(<Step2Screen />);
    expect(getByTestId('step2-phone-input')).toBeTruthy();
    expect(getByTestId('step2-uemoa-consent-row')).toBeTruthy();
  });

  test('bouton confirmer désactivé sans UEMOA', () => {
    const { getByTestId } = render(<Step2Screen />);
    const confirmButton = getByTestId('step2-confirm-button');
    expect(confirmButton.props.accessibilityState?.disabled).toBe(true);
  });

  test('bouton confirmer actif avec UEMOA', async () => {
    const { getByTestId } = render(<Step2Screen />);
    fireEvent(getByTestId('step2-uemoa-switch'), 'valueChange', true);
    await waitFor(() => {
      const confirmButton = getByTestId('step2-confirm-button');
      expect(confirmButton.props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  test('message UEMOA requis visible sans consentement', () => {
    const { getByTestId } = render(<Step2Screen />);
    expect(getByTestId('step2-uemoa-required')).toBeTruthy();
  });

  test('flow complet : saisie téléphone + UEMOA + confirmation', async () => {
    const { getByTestId } = render(<Step2Screen />);

    fireEvent.changeText(getByTestId('step2-phone-input'), '+2250102030405');
    fireEvent(getByTestId('step2-uemoa-switch'), 'valueChange', true);

    await waitFor(() => {
      const button = getByTestId('step2-confirm-button');
      expect(button.props.accessibilityState?.disabled).toBeFalsy();
    });

    fireEvent.press(getByTestId('step2-confirm-button'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/(app)/new-ticket/step-3');
    });
  });
});
