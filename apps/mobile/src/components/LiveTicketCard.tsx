// LiveTicketCard.tsx — MOB-003
// Carte plein-écran ticket vivant: position, barre de progression, estimation
// 5 états canoniques: loading (skeleton), empty, idle, active, error
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

export type LiveTicketState = 'loading' | 'empty' | 'idle' | 'active' | 'error' | 'nominal';

export interface LiveTicketCardProps {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
  screenState: LiveTicketState;
  onRetry?: () => void;
  errorMessage?: string;
  isOffline?: boolean;
  // Position maximale connue (pour la barre de progression)
  maxPosition?: number;
}

/**
 * LiveTicketCard — carte plein-écran pour le suivi du ticket vivant.
 * Affiche: numéro d'appel, position dans la file, barre de progression, estimation.
 * 5 états canoniques: loading (skeleton) ≠ empty, idle, active, error.
 */
export function LiveTicketCard({
  displayNumber,
  position,
  estimatedWaitMinutes,
  screenState,
  onRetry,
  errorMessage,
  isOffline = false,
  maxPosition = 10,
}: LiveTicketCardProps): React.JSX.Element {
  const progress = maxPosition > 0 ? Math.max(0, Math.min(1, 1 - (position / maxPosition))) : 0;

  // === État LOADING (skeleton) ===
  if (screenState === 'loading') {
    return (
      <View style={styles.container} testID="live-ticket-skeleton">
        <View style={[styles.skeletonLine, styles.skeletonLarge]} />
        <View style={[styles.skeletonLine, styles.skeletonMedium]} />
        <View style={[styles.skeletonLine, styles.skeletonSmall]} />
        <View style={[styles.skeletonLine, styles.skeletonProgress]} />
        <ActivityIndicator
          size="small"
          color={tokens.colors.brand}
          style={styles.skeletonLoader}
        />
      </View>
    );
  }

  // === État EMPTY ===
  if (screenState === 'empty') {
    return (
      <View style={styles.center} testID="live-ticket-empty">
        <Text style={styles.emptyLabel}>{i18n.t('liveTicket.noActiveTicket')}</Text>
      </View>
    );
  }

  // === État ERROR ===
  if (screenState === 'error') {
    return (
      <View style={styles.center} testID="live-ticket-error">
        <Text style={styles.errorLabel}>
          {errorMessage ?? i18n.t('liveTicket.notFound')}
        </Text>
        {onRetry && (
          <TouchableOpacity
            onPress={onRetry}
            style={styles.retryButton}
            testID="live-ticket-retry"
          >
            <Text style={styles.retryText}>{i18n.t('screen.retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // === État ACTIVE (ticket:called — "Votre tour !") ===
  if (screenState === 'active') {
    return (
      <View style={styles.activeContainer} testID="live-ticket-called">
        <Text style={styles.calledLabel}>{i18n.t('liveTicket.yourTurn')}</Text>
        <Text style={styles.displayNumberCalled} testID="live-ticket-display-number">
          {displayNumber}
        </Text>
        {isOffline && (
          <View style={styles.offlineBadge} testID="live-ticket-offline-badge">
            <Text style={styles.offlineBadgeText}>{i18n.t('offline.badge')}</Text>
          </View>
        )}
      </View>
    );
  }

  // === État IDLE (nominal — ticket en attente) ===
  return (
    <View style={styles.container} testID="live-ticket-idle">
      {isOffline && (
        <View style={styles.offlineBadge} testID="live-ticket-offline-badge">
          <Text style={styles.offlineBadgeText}>{i18n.t('offline.badge')}</Text>
        </View>
      )}

      <Text style={styles.displayNumber} testID="live-ticket-display-number">
        {displayNumber}
      </Text>

      <Text style={styles.positionLabel} testID="live-ticket-position">
        {i18n.t('ticket.position')}: <Text style={styles.positionValue}>{position}</Text>
      </Text>

      <Text style={styles.estimateLabel} testID="live-ticket-estimate">
        {i18n.t('ticket.estimatedWait')}: <Text style={styles.estimateValue}>{estimatedWaitMinutes} min</Text>
      </Text>

      {/* Barre de progression vers "c'est votre tour" */}
      <View style={styles.progressContainer} testID="live-ticket-progress">
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%` as unknown as number },
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>
          {position === 0
            ? i18n.t('liveTicket.yourTurn')
            : `${position} ${i18n.t('liveTicket.personsBefore')}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.colors.surface1,
    padding: tokens.spacing.xl,
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.xl,
  },
  activeContainer: {
    flex: 1,
    backgroundColor: tokens.colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.xl,
  },

  // Display number
  displayNumber: {
    fontSize: tokens.fontSize.display,
    fontWeight: 'bold',
    color: tokens.colors.brand,
    textAlign: 'center',
    marginBottom: tokens.spacing.xl,
    marginTop: tokens.spacing.xxl,
  },
  displayNumberCalled: {
    fontSize: tokens.fontSize.display,
    fontWeight: 'bold',
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginTop: tokens.spacing.md,
  },

  // Position
  positionLabel: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.sm,
  },
  positionValue: {
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
  },

  // Estimation
  estimateLabel: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.xl,
  },
  estimateValue: {
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
  },

  // Progress bar
  progressContainer: {
    width: '100%',
    marginTop: tokens.spacing.lg,
  },
  progressTrack: {
    height: 8,
    backgroundColor: tokens.colors.brandSoft,
    borderRadius: tokens.radius.badge,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: tokens.colors.brand,
    borderRadius: tokens.radius.badge,
  },
  progressLabel: {
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
    marginTop: tokens.spacing.sm,
  },

  // Called state
  calledLabel: {
    fontSize: tokens.fontSize.title,
    fontWeight: 'bold',
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginBottom: tokens.spacing.md,
  },

  // Error
  errorLabel: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.danger,
    textAlign: 'center',
    marginBottom: tokens.spacing.lg,
  },
  retryButton: {
    backgroundColor: tokens.colors.brand,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.button,
    minHeight: tokens.minTouchTarget,
    justifyContent: 'center',
  },
  retryText: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.body,
  },

  // Empty
  emptyLabel: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
  },

  // Offline badge
  offlineBadge: {
    position: 'absolute',
    top: tokens.spacing.sm,
    right: tokens.spacing.sm,
    backgroundColor: tokens.colors.info,
    borderRadius: tokens.radius.badge,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
  },
  offlineBadgeText: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.caption,
    fontWeight: 'bold',
  },

  // Skeleton
  skeletonLine: {
    backgroundColor: tokens.colors.surface0,
    borderRadius: tokens.radius.card,
    marginBottom: tokens.spacing.md,
  },
  skeletonLarge: {
    width: '60%',
    height: 40,
    marginTop: tokens.spacing.xxl,
  },
  skeletonMedium: {
    width: '40%',
    height: 20,
  },
  skeletonSmall: {
    width: '30%',
    height: 16,
  },
  skeletonProgress: {
    width: '80%',
    height: 8,
    marginTop: tokens.spacing.xl,
  },
  skeletonLoader: {
    marginTop: tokens.spacing.xl,
  },
});
