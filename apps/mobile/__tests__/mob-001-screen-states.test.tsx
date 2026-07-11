// __tests__/mob-001-screen-states.test.tsx
// MOB-001: ScreenState — 5 états rendus correctement
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ScreenState } from '../src/components/ScreenState';

describe('MOB-001: ScreenState — 5 états rendus correctement', () => {
  test('état loading affiche ActivityIndicator', () => {
    const { getByTestId } = render(<ScreenState state="loading" />);
    expect(getByTestId('screen-loading')).toBeTruthy();
  });

  test('état error affiche le message d\'erreur', () => {
    const { getByTestId, getByText } = render(
      <ScreenState state="error" errorMessage="Erreur test" />
    );
    expect(getByTestId('screen-error')).toBeTruthy();
    expect(getByText('Erreur test')).toBeTruthy();
  });

  test('état error avec bouton retry', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <ScreenState state="error" onRetry={onRetry} />
    );
    fireEvent.press(getByText('Réessayer'));
    expect(onRetry).toHaveBeenCalled();
  });

  test('état empty affiche le message vide', () => {
    const { getByTestId } = render(<ScreenState state="empty" />);
    expect(getByTestId('screen-empty')).toBeTruthy();
  });

  test('état empty avec message personnalisé', () => {
    const { getByText } = render(
      <ScreenState state="empty" emptyMessage="Aucun ticket" />
    );
    expect(getByText('Aucun ticket')).toBeTruthy();
  });

  test('état offline affiche le message offline', () => {
    const { getByTestId } = render(<ScreenState state="offline" />);
    expect(getByTestId('screen-offline')).toBeTruthy();
  });

  test('état offline avec bouton retry', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <ScreenState state="offline" onRetry={onRetry} />
    );
    fireEvent.press(getByText('Réessayer'));
    expect(onRetry).toHaveBeenCalled();
  });

  test('état nominal affiche les enfants', () => {
    const { getByText } = render(
      <ScreenState state="nominal">
        <React.Fragment>
          {React.createElement('Text', null, 'Contenu nominal')}
        </React.Fragment>
      </ScreenState>
    );
    expect(getByText('Contenu nominal')).toBeTruthy();
  });
});
