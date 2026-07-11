// __tests__/mob-002-steps.test.tsx
// MOB-002: parcours 3 étapes — navigation Étape 1 → 2 → 3 sans régression
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Step1Screen from '../app/(app)/new-ticket/step-1';
import Step2Screen from '../app/(app)/new-ticket/step-2';
import Step3Screen from '../app/(app)/new-ticket/step-3';

describe('MOB-002: parcours 3 étapes — navigation Étape 1 → 2 → 3 sans régression', () => {
  test('Step1 se rend avec les options agence et service', () => {
    const { getByTestId } = render(<Step1Screen />);
    expect(getByTestId('agency-agency-1')).toBeTruthy();
    expect(getByTestId('service-service-1')).toBeTruthy();
  });

  test('Step1 bouton suivant désactivé sans sélection', () => {
    const { getByTestId } = render(<Step1Screen />);
    const nextButton = getByTestId('next-step-1');
    expect(nextButton.props.accessibilityState?.disabled).toBe(true);
  });

  test('Step1 bouton suivant actif après sélection', async () => {
    const { getByTestId } = render(<Step1Screen />);
    fireEvent.press(getByTestId('agency-agency-1'));
    fireEvent.press(getByTestId('service-service-1'));
    await waitFor(() => {
      const nextButton = getByTestId('next-step-1');
      expect(nextButton.props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  test('Step2 se rend avec les champs requis', () => {
    const { getByTestId } = render(<Step2Screen />);
    expect(getByTestId('step2-phone-input')).toBeTruthy();
    expect(getByTestId('step2-uemoa-consent-row')).toBeTruthy();
    expect(getByTestId('step2-confirm-button')).toBeTruthy();
  });

  test('Step3 se rend avec le ticket de confirmation', () => {
    const { getByTestId } = render(<Step3Screen />);
    expect(getByTestId('ticket-confirmation-card')).toBeTruthy();
    expect(getByTestId('display-number')).toBeTruthy();
  });
});
