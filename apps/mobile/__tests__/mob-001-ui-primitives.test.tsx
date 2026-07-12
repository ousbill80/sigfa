// __tests__/mob-001-ui-primitives.test.tsx
// MOB-001: primitives RN du Design System v2 (Button / Card / Field / ScreenTitle).
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button, Card, Field, ScreenTitle } from '../src/components/ui';

describe('MOB-001: primitives v2 — Button', () => {
  test('primary : rend le label et déclenche onPress', () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = render(
      <Button label="Continuer" onPress={onPress} testID="btn-primary" />,
    );
    fireEvent.press(getByTestId('btn-primary'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getByText('Continuer')).toBeTruthy();
  });

  test('secondary et ghost rendent sans crash', () => {
    const { getByText } = render(
      <>
        <Button label="Secondaire" variant="secondary" />
        <Button label="Fantôme" variant="ghost" />
      </>,
    );
    expect(getByText('Secondaire')).toBeTruthy();
    expect(getByText('Fantôme')).toBeTruthy();
  });

  test('disabled : onPress non déclenché', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button label="Bloqué" onPress={onPress} disabled testID="btn-disabled" />,
    );
    fireEvent.press(getByTestId('btn-disabled'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('MOB-001: primitives v2 — Card / Field / ScreenTitle', () => {
  test('Card paper et night rendent les enfants', () => {
    const { getByText } = render(
      <>
        <Card testID="card-paper"><ScreenTitle>Papier</ScreenTitle></Card>
        <Card tone="night" testID="card-night"><ScreenTitle>Nuit</ScreenTitle></Card>
      </>,
    );
    expect(getByText('Papier')).toBeTruthy();
    expect(getByText('Nuit')).toBeTruthy();
  });

  test('Field affiche label et erreur inline', () => {
    const { getByText } = render(
      <Field label="Téléphone" error="Champ requis" placeholder="+225" />,
    );
    expect(getByText('Téléphone')).toBeTruthy();
    expect(getByText('Champ requis')).toBeTruthy();
  });

  test('Field sans label ni erreur rend l\'input seul', () => {
    const { queryByText } = render(<Field placeholder="sans label" />);
    expect(queryByText('Champ requis')).toBeNull();
  });
});
