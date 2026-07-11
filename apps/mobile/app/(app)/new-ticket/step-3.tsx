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
    fontSize: tokens.fontSize.title,
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
    marginBottom: tokens.spacing.xl,
  },
  ticketCard: {
    backgroundColor: tokens.colors.surface1,
    borderRadius: tokens.radius.card,
    padding: tokens.spacing.xl,
    marginBottom: tokens.spacing.xl,
  },
  displayNumber: {
    fontSize: tokens.fontSize.display,
    fontWeight: 'bold',
    color: tokens.colors.brand,
    textAlign: 'center',
    marginBottom: tokens.spacing.lg,
  },
  label: {
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.inkSoft,
    marginTop: tokens.spacing.sm,
  },
  value: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkStrong,
    fontWeight: 'bold',
  },
  queuedNotice: {
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.warning,
    marginTop: tokens.spacing.md,
    textAlign: 'center',
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
