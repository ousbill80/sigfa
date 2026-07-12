// app/(app)/index.tsx — Home screen (authenticated) · Refonte v2 « Sérénité Premium »
// Logique, navigation et testIDs INCHANGÉS — seule l'apparence évolue.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { OfflineBadge } from '@/components/OfflineBadge';
import { LanguageSelector } from '@/components/LanguageSelector';

export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <LanguageSelector />
        <OfflineBadge />
      </View>

      <View style={styles.hero}>
        <Text style={styles.greeting}>{i18n.t('nav.home')}</Text>
        <Text style={styles.lead}>{i18n.t('ticket.title')}</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(app)/new-ticket/step-1')}
        activeOpacity={0.85}
        testID="new-ticket-button"
        accessibilityLabel={i18n.t('nav.newTicket')}
      >
        <Text style={styles.buttonText}>{i18n.t('nav.newTicket')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: tokens.spacing.xl,
    backgroundColor: tokens.colors.surface0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.spacing.sm,
    marginBottom: tokens.spacing.xxxl,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  greeting: {
    fontSize: tokens.fontSize['3xl'],
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.8,
    marginBottom: tokens.spacing.sm,
  },
  lead: {
    fontSize: tokens.fontSize.lg,
    color: tokens.colors.inkSoft,
    lineHeight: 28,
  },
  button: {
    backgroundColor: tokens.colors.brand,
    minHeight: tokens.minTouchTarget + 12,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: tokens.spacing.lg,
    ...tokens.shadow.brand,
  },
  buttonText: {
    color: tokens.colors.brandContrast,
    fontSize: tokens.fontSize.lg,
    fontWeight: '700',
  },
});
