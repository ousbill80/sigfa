// app/(app)/index.tsx — Home screen (authenticated)
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { OfflineBadge } from '@/components/OfflineBadge';

export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <OfflineBadge />
      <Text style={styles.title}>{i18n.t('nav.home')}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(app)/new-ticket/step-1')}
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
  title: {
    fontSize: tokens.fontSize.title,
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
    marginBottom: tokens.spacing.xl,
  },
  button: {
    backgroundColor: tokens.colors.brand,
    height: tokens.minTouchTarget,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.body,
    fontWeight: 'bold',
  },
});
