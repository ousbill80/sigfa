// app/(app)/ticket/[trackingId].tsx — Suivi ticket
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { ScreenState } from '@/components/ScreenState';
import { fetchTicketStatus, type TicketStatus } from '@/services/api';

export default function TicketScreen(): React.JSX.Element {
  const { trackingId } = useLocalSearchParams<{ trackingId: string }>();
  const [ticket, setTicket] = useState<TicketStatus | null>(null);
  const [screenState, setScreenState] = useState<'loading' | 'error' | 'nominal'>('loading');

  useEffect(() => {
    if (!trackingId) return;

    setScreenState('loading');
    fetchTicketStatus(trackingId)
      .then(data => {
        setTicket(data);
        setScreenState('nominal');
      })
      .catch(() => {
        setScreenState('error');
      });
  }, [trackingId]);

  return (
    <ScreenState state={screenState}>
      {ticket && (
        <View style={styles.container}>
          <Text style={styles.displayNumber} testID="ticket-display-number">
            {ticket.displayNumber}
          </Text>
          <Text style={styles.label}>{i18n.t('ticket.trackingId')}: {ticket.trackingId}</Text>
          <Text style={styles.label}>{i18n.t('ticket.position')}: {ticket.position}</Text>
          <Text style={styles.label}>
            {i18n.t('ticket.estimatedWait')}: {ticket.estimatedWaitMinutes} min
          </Text>
        </View>
      )}
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: tokens.spacing.xl,
    backgroundColor: tokens.colors.surface0,
  },
  displayNumber: {
    fontSize: tokens.fontSize['4xl'],
    fontWeight: '700',
    color: tokens.colors.brand,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: tokens.spacing.xl,
  },
  label: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.md,
  },
});
