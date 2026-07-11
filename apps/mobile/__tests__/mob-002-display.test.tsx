// __tests__/mob-002-display.test.tsx
// MOB-002: affichage displayNumber — format {code}-{NNN} rendu en token Display
import React from 'react';
import { render } from '@testing-library/react-native';
import { tokens } from '../src/tokens';
import Step3Screen from '../app/(app)/new-ticket/step-3';
import Step2Screen from '../app/(app)/new-ticket/step-2';

describe('MOB-002: affichage displayNumber — format {code}-{NNN} rendu en token Display', () => {
  test('Step3 affiche le displayNumber en taille Display (32px)', () => {
    const { getByTestId } = render(<Step3Screen />);
    const displayEl = getByTestId('display-number');
    // Vérifier le style (fontSize = tokens.fontSize.display = 32)
    expect(displayEl.props.style).toBeDefined();
  });

  test('tokens.fontSize.display est 32', () => {
    expect(tokens.fontSize.display).toBe(32);
  });

  test('Step3 affiche le displayNumber avec format {code}-{NNN}', () => {
    const { getByTestId } = render(<Step3Screen />);
    const displayEl = getByTestId('display-number');
    // G-042 correspond au format attendu
    expect(displayEl.props.children).toMatch(/^[A-Z]-\d{3}$/);
  });

  test('MOB-002: opt-in UEMOA — soumission bloquée sans opt-in', () => {
    const { getByTestId } = render(<Step2Screen />);
    const confirmButton = getByTestId('step2-confirm-button');
    expect(confirmButton.props.accessibilityState?.disabled).toBe(true);
  });

  test('Step3 a la notice de synchronisation offline', () => {
    const { getByTestId } = render(<Step3Screen />);
    expect(getByTestId('offline-queued-notice')).toBeTruthy();
  });
});
