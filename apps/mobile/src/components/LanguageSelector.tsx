// LanguageSelector.tsx — Sélecteur de langue FR/EN (refonte v2).
// Deux pastilles au pouce ; l'or marque la langue active. Aucune valeur hex en dur.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { tokens } from '@/tokens';
import { i18n, supportedLocales, setLocale, type SupportedLocale } from '@/i18n';

export interface LanguageSelectorProps {
  onChange?: (locale: SupportedLocale) => void;
}

export function LanguageSelector({ onChange }: LanguageSelectorProps): React.JSX.Element {
  const [active, setActive] = useState<SupportedLocale>(
    (i18n.locale as SupportedLocale) ?? 'fr',
  );

  function handleSelect(code: SupportedLocale): void {
    const next = setLocale(code);
    setActive(next);
    onChange?.(next);
  }

  return (
    <View style={styles.container} testID="language-selector" accessibilityRole="radiogroup">
      {supportedLocales.map(code => {
        const selected = active === code;
        return (
          <TouchableOpacity
            key={code}
            testID={`language-option-${code}`}
            onPress={() => handleSelect(code)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={i18n.t(`language.${code}`)}
            style={[styles.pill, selected && styles.pillActive]}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>
              {i18n.t(`language.${code}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    alignSelf: 'flex-start',
  },
  pill: {
    minHeight: tokens.minTouchTarget,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.colors.hairline,
    backgroundColor: tokens.colors.surface1,
    justifyContent: 'center',
  },
  pillActive: {
    borderColor: tokens.colors.gold,
    backgroundColor: tokens.colors.goldSoft,
  },
  label: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
    fontWeight: '600',
  },
  labelActive: {
    color: tokens.colors.inkStrong,
    fontWeight: '700',
  },
});
