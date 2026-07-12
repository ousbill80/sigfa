// app/_layout.tsx — Root layout Expo Router v3 (+ gate S8 Boucle 2 F4)
// Gate S8 : initSecureStorage() (clé trousseau + MMKV chiffré) doit être
// résolue AVANT de monter les écrans — aucun accès MMKV avant chiffrement.
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { initSecureStorage } from '@/services/secure-storage';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

type SecureStorageGateState = 'loading' | 'ready' | 'error';

export default function RootLayout(): React.JSX.Element {
  const [gateState, setGateState] = useState<SecureStorageGateState>('loading');

  useEffect(() => {
    let cancelled = false;
    initSecureStorage()
      .then(() => {
        if (!cancelled) setGateState('ready');
      })
      .catch(() => {
        if (!cancelled) setGateState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gateState === 'error') {
    return (
      <View style={styles.gate} testID="secure-storage-error">
        <Text style={styles.errorText}>{i18n.t('screen.error')}</Text>
      </View>
    );
  }

  if (gateState === 'loading') {
    return (
      <View style={styles.gate} testID="secure-storage-gate">
        <ActivityIndicator
          size="large"
          color={tokens.colors.brand}
          accessibilityLabel={i18n.t('screen.loading')}
        />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.colors.surface0,
  },
  errorText: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.danger,
    textAlign: 'center',
    padding: tokens.spacing.xl,
  },
});
