// ScreenState.tsx — MOB-001
// Composant 5 états (nominal/loading/empty/error/offline)
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

export type ScreenStateType = 'nominal' | 'loading' | 'empty' | 'error' | 'offline';

interface ScreenStateProps {
  state: ScreenStateType;
  children?: React.ReactNode;
  onRetry?: () => void;
  errorMessage?: string;
  emptyMessage?: string;
}

export function ScreenState({
  state,
  children,
  onRetry,
  errorMessage,
  emptyMessage,
}: ScreenStateProps): React.JSX.Element {
  switch (state) {
    case 'loading':
      return (
        <View style={styles.center} testID="screen-loading">
          <ActivityIndicator size="large" color={tokens.colors.brand} />
          <Text style={styles.label}>{i18n.t('screen.loading')}</Text>
        </View>
      );

    case 'error':
      return (
        <View style={styles.center} testID="screen-error">
          <Text style={[styles.label, styles.error]}>{errorMessage ?? i18n.t('screen.error')}</Text>
          {onRetry && (
            <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>{i18n.t('screen.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      );

    case 'empty':
      return (
        <View style={styles.center} testID="screen-empty">
          <Text style={styles.label}>{emptyMessage ?? i18n.t('screen.empty')}</Text>
        </View>
      );

    case 'offline':
      return (
        <View style={styles.center} testID="screen-offline">
          <Text style={[styles.label, styles.offline]}>{i18n.t('screen.offline')}</Text>
          {onRetry && (
            <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>{i18n.t('screen.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      );

    case 'nominal':
    default:
      return <>{children}</>;
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.xl,
  },
  label: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
    marginTop: tokens.spacing.sm,
  },
  error: {
    color: tokens.colors.danger,
  },
  offline: {
    color: tokens.colors.warning,
  },
  retryButton: {
    marginTop: tokens.spacing.lg,
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
});
