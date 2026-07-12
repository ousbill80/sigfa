// HistoryScreen.tsx — MOB-005
// Écran historique des tickets : liste MMKV, infini scroll, badge feedback en attente
import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { hasPendingFeedback, type HistoryEntry } from '@/services/history-mmkv';

export interface HistoryScreenProps {
  entries?: HistoryEntry[];
  isLoading: boolean;
  onEndReached?: () => void;
}

/**
 * HistoryScreen — liste des tickets précédents depuis MMKV.
 * Badge de rappel discret sur les tickets DONE sans feedback dans la fenêtre 24h.
 * État empty si aucun ticket.
 */
export function HistoryScreen({
  entries = [],
  isLoading,
  onEndReached,
}: HistoryScreenProps): React.JSX.Element {
  // Badge global — vrai s'il y a au moins un ticket avec feedback en attente
  const hasBadge = entries.some(hasPendingFeedback);

  if (isLoading) {
    return (
      <View style={styles.center} testID="history-loading">
        <ActivityIndicator size="large" color={tokens.colors.brand} />
      </View>
    );
  }

  if (!entries.length) {
    return (
      <View style={styles.center} testID="history-empty">
        <Text style={styles.emptyLabel}>{i18n.t('feedback.historyEmpty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="history-list">
      {/* Badge de rappel si feedback en attente */}
      {hasBadge && (
        <View style={styles.badge} testID="history-feedback-badge">
          <Text style={styles.badgeText}>{i18n.t('feedback.badgeReminder')}</Text>
        </View>
      )}

      <FlatList
        data={entries}
        keyExtractor={item => item.trackingId}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        renderItem={({ item }) => (
          <View style={styles.entryRow} testID={`history-entry-${item.trackingId}`}>
            <Text style={styles.entryNumber} testID={`history-number-${item.trackingId}`}>
              {item.displayNumber}
            </Text>
            <Text style={styles.entryDate}>{item.date}</Text>
            {item.rating !== undefined && (
              <Text style={styles.entryRating}>{'★'.repeat(item.rating)}</Text>
            )}
            {hasPendingFeedback(item) && (
              <View style={styles.entryBadge} testID={`history-entry-badge-${item.trackingId}`}>
                <Text style={styles.entryBadgeText}>{i18n.t('feedback.badgeReminder')}</Text>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.colors.surface0,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.colors.surface0,
    padding: tokens.spacing.xl,
  },

  // Empty state
  emptyLabel: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
  },

  // Global badge de rappel (brand-soft, pictogramme doux)
  badge: {
    margin: tokens.spacing.lg,
    backgroundColor: tokens.colors.brandSoft,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: tokens.colors.brandStrong,
    fontSize: tokens.fontSize.sm,
    fontWeight: '700',
  },

  // Entries
  entryRow: {
    backgroundColor: tokens.colors.surface1,
    padding: tokens.spacing.lg,
    marginHorizontal: tokens.spacing.lg,
    marginVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...tokens.shadow.card,
  },
  entryNumber: {
    fontSize: tokens.fontSize.lg,
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.3,
  },
  entryDate: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
  },
  entryRating: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.gold,
  },
  entryBadge: {
    backgroundColor: tokens.colors.brandSoft,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
  },
  entryBadgeText: {
    color: tokens.colors.brandStrong,
    fontSize: tokens.fontSize.xs,
    fontWeight: '700',
  },
});
