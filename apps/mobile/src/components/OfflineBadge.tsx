// OfflineBadge.tsx — MOB-001
// Badge offline discret affiché quand NetInfo détecte la déconnexion
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { tokens } from '@/tokens';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { i18n } from '@/i18n';

export function OfflineBadge(): React.JSX.Element | null {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View style={styles.container} testID="offline-badge" accessibilityLabel={i18n.t('offline.badge')}>
      <Text style={styles.text}>{i18n.t('offline.badge')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: tokens.colors.info,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
    borderRadius: tokens.radius.full,
    alignSelf: 'center',
  },
  text: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.xs,
    fontWeight: '700',
  },
});
