// __tests__/mob-001-language-selector.test.tsx
// MOB-001: sélecteur de langue FR/EN (refonte v2 — retrait dioula/baoulé).
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { i18n } from '../src/i18n';

afterEach(() => {
  i18n.locale = 'fr';
});

describe('MOB-001: LanguageSelector — FR/EN uniquement', () => {
  test('affiche exactement deux options : FR et EN', () => {
    const { getByTestId, queryByTestId } = render(<LanguageSelector />);
    expect(getByTestId('language-option-fr')).toBeTruthy();
    expect(getByTestId('language-option-en')).toBeTruthy();
    // Aucune option dioula/baoulé
    expect(queryByTestId('language-option-dioula')).toBeNull();
    expect(queryByTestId('language-option-baoule')).toBeNull();
  });

  test('sélectionner EN bascule la locale i18n', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<LanguageSelector onChange={onChange} />);
    fireEvent.press(getByTestId('language-option-en'));
    expect(i18n.locale).toBe('en');
    expect(onChange).toHaveBeenCalledWith('en');
  });

  test('sélectionner FR revient au français', () => {
    const { getByTestId } = render(<LanguageSelector />);
    fireEvent.press(getByTestId('language-option-en'));
    fireEvent.press(getByTestId('language-option-fr'));
    expect(i18n.locale).toBe('fr');
  });
});
