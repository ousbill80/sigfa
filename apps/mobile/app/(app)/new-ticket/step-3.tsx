// app/(app)/new-ticket/step-3.tsx — Confirmation ticket
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

interface TicketConfirmation {
  displayNumber?: string;
  trackingId?: string;
}

export default function Step3Screen(): React.JSX.Element {
  const router = useRouter();

  // Simuler un ticket confirmé (en production, viendrait du state/params)
  const mockTicket: TicketConfirmation = {
    displayNumber: 'G-042',
    trackingId: 'XYZ_1234567890_ABCDEF',
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{i18n.t('ticket.step3Title')}</Text>

      <View style={styles.ticketCard} testID="ticket-confirmation-card">
        <Text style={styles.displayNumber} testID="display-number">
          {mockTicket.displayNumber}
        </Text>
        <Text style={styles.label}>{i18n.t('ticket.trackingId')}</Text>
        <Text style={styles.value} testID="tracking-id">{mockTicket.trackingId}</Text>
        <Text style={styles.queuedNotice} testID="offline-queued-notice">
          {i18n.t('offline.queued')}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/(app)')}
        testID="back-home-button"
        accessibilityLabel={i18n.t('nav.home')}
      >
        <Text style={styles.buttonText}>{i18n.t('nav.home')}</Text>
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
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.4,
    marginBottom: tokens.spacing.xl,
  },
  // « Moment Ticket » : carte nuit, numéro or
  ticketCard: {
    backgroundColor: tokens.colors.night,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.xxl,
    marginBottom: tokens.spacing.xl,
    alignItems: 'center',
    ...tokens.shadow.lifted,
  },
  displayNumber: {
    fontSize: tokens.fontSize.hero,
    fontWeight: '700',
    color: tokens.colors.gold,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: tokens.spacing.lg,
  },
  label: {
    fontSize: tokens.fontSize.xs,
    color: tokens.colors.inkInverseSoft,
    marginTop: tokens.spacing.md,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkInverse,
    fontWeight: '700',
  },
  queuedNotice: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkInverseSoft,
    marginTop: tokens.spacing.lg,
    textAlign: 'center',
  },
  button: {
    backgroundColor: tokens.colors.brand,
    minHeight: tokens.minTouchTarget + 8,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    ...tokens.shadow.brand,
  },
  buttonText: {
    color: tokens.colors.brandContrast,
    fontSize: tokens.fontSize.md,
    fontWeight: '700',
  },
});
