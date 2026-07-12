// LiveTicketCard.tsx — MOB-003 · Refonte v2 « Moment Ticket »
// Le héros de l'expérience client hors agence : ticket vivant.
// Style « Moment Ticket » : fond nuit, numéro or avec halo, message rassurant,
// position temps réel, barre de progression, respiration généreuse.
// 5 états canoniques CONSERVÉS : loading (skeleton) ≠ empty, idle, active, error.
// Logique, props, testIDs et parcours INCHANGÉS — seule l'apparence évolue.
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
 * Affiche: numéro d'appel (or, halo), position dans la file, progression, estimation, message rassurant.
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
          color={tokens.colors.gold}
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
            activeOpacity={0.85}
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
        <Text style={styles.calledSubtitle}>{i18n.t('liveTicket.yourTurnSubtitle')}</Text>
        {isOffline && (
          <View style={styles.offlineBadge} testID="live-ticket-offline-badge">
            <Text style={styles.offlineBadgeText}>{i18n.t('offline.badge')}</Text>
          </View>
        )}
      </View>
    );
  }

  // === État IDLE (nominal — ticket en attente) · « Moment Ticket » ===
  return (
    <View style={styles.momentContainer} testID="live-ticket-idle">
      {isOffline && (
        <View style={styles.offlineBadge} testID="live-ticket-offline-badge">
          <Text style={styles.offlineBadgeText}>{i18n.t('offline.badge')}</Text>
        </View>
      )}

      <Text style={styles.numberCaption}>{i18n.t('liveTicket.numberLabel')}</Text>

      {/* Numéro héros — or patiné, halo doux */}
      <View style={styles.numberHalo}>
        <Text style={styles.displayNumber} testID="live-ticket-display-number">
          {displayNumber}
        </Text>
      </View>

      {/* Message rassurant SIGFA */}
      <Text style={styles.reassure}>{i18n.t('liveTicket.reassure')}</Text>

      {/* Bloc position + estimation */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Text style={styles.metricValue} testID="live-ticket-position">
            {position}
          </Text>
          <Text style={styles.metricLabel}>{i18n.t('ticket.position')}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue} testID="live-ticket-estimate">
            {estimatedWaitMinutes} min
          </Text>
          <Text style={styles.metricLabel}>{i18n.t('ticket.estimatedWait')}</Text>
        </View>
      </View>

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

      <Text style={styles.updatedNote}>{i18n.t('liveTicket.updatedEvery30s')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.colors.surface0,
    padding: tokens.spacing.xl,
    alignItems: 'center',
  },
  // « Moment Ticket » : fond nuit qui fait vibrer l'or
  momentContainer: {
    flex: 1,
    backgroundColor: tokens.colors.night,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.xxxl,
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.colors.surface0,
    padding: tokens.spacing.xl,
  },
  activeContainer: {
    flex: 1,
    backgroundColor: tokens.colors.forest,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.xl,
  },

  // Caption au-dessus du numéro
  numberCaption: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkInverseSoft,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: tokens.spacing.xl,
    marginBottom: tokens.spacing.md,
  },

  // Numéro héros (or, halo)
  numberHalo: {
    ...tokens.shadow.gold,
    borderRadius: tokens.radius.xl,
    paddingHorizontal: tokens.spacing.lg,
  },
  displayNumber: {
    fontSize: tokens.fontSize.hero,
    fontWeight: '700',
    color: tokens.colors.gold,
    textAlign: 'center',
    letterSpacing: -1,
  },
  displayNumberCalled: {
    fontSize: tokens.fontSize.hero,
    fontWeight: '700',
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginTop: tokens.spacing.md,
    letterSpacing: -1,
  },

  // Message rassurant
  reassure: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: tokens.spacing.xl,
    marginBottom: tokens.spacing.xxl,
    paddingHorizontal: tokens.spacing.md,
  },

  // Metrics row (position / estimation)
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(199,154,58,0.10)',
    borderRadius: tokens.radius.lg,
    paddingVertical: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.xl,
    marginBottom: tokens.spacing.xxl,
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(184,171,152,0.35)',
    marginHorizontal: tokens.spacing.lg,
  },
  metricValue: {
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.inkInverse,
  },
  metricLabel: {
    fontSize: tokens.fontSize.xs,
    color: tokens.colors.inkInverseSoft,
    marginTop: tokens.spacing.xs,
  },

  // Progress bar
  progressContainer: {
    width: '100%',
    marginTop: tokens.spacing.md,
  },
  progressTrack: {
    height: 10,
    backgroundColor: 'rgba(184,171,152,0.25)',
    borderRadius: tokens.radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: tokens.colors.gold,
    borderRadius: tokens.radius.full,
  },
  progressLabel: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginTop: tokens.spacing.md,
    fontWeight: '600',
  },
  updatedNote: {
    fontSize: tokens.fontSize.xs,
    color: tokens.colors.inkInverseSoft,
    textAlign: 'center',
    marginTop: tokens.spacing.xl,
  },

  // Called state
  calledLabel: {
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginBottom: tokens.spacing.md,
    letterSpacing: 0.5,
  },
  calledSubtitle: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkInverse,
    textAlign: 'center',
    marginTop: tokens.spacing.lg,
    opacity: 0.92,
  },

  // Error
  errorLabel: {
    fontSize: tokens.fontSize.md,
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
    ...tokens.shadow.brand,
  },
  retryText: {
    color: tokens.colors.brandContrast,
    fontSize: tokens.fontSize.md,
    fontWeight: '700',
  },

  // Empty
  emptyLabel: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
  },

  // Offline badge
  offlineBadge: {
    position: 'absolute',
    top: tokens.spacing.md,
    right: tokens.spacing.md,
    backgroundColor: tokens.colors.info,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
  },
  offlineBadgeText: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.xs,
    fontWeight: '700',
  },

  // Skeleton
  skeletonLine: {
    backgroundColor: tokens.colors.surface2,
    borderRadius: tokens.radius.md,
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
    height: 10,
    marginTop: tokens.spacing.xl,
  },
  skeletonLoader: {
    marginTop: tokens.spacing.xl,
  },
});
