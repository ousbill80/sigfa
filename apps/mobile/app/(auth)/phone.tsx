// app/(auth)/phone.tsx — Écran saisie téléphone + OTP · Refonte v2 « Sérénité Premium »
// Logique, handlers, testIDs, parcours OTP (fixture 123456) INCHANGÉS — seule l'apparence évolue.
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';
import { LanguageSelector } from '@/components/LanguageSelector';

export default function PhoneScreen(): React.JSX.Element {
  const router = useRouter();
  const { step, phone, isLoading, error, setPhone, sendOtp, verifyCode } = useAuth();
  const [otp, setOtp] = useState('');
  const [uemoa, setUemoa] = useState(false);

  async function handleSendOtp(): Promise<void> {
    if (!uemoa) return;
    await sendOtp();
  }

  async function handleVerify(): Promise<void> {
    const ok = await verifyCode(otp);
    if (ok) {
      router.replace('/(app)');
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <LanguageSelector />
      </View>

      <Text style={styles.brandMark}>SIGFA</Text>
      <Text style={styles.title}>{i18n.t('auth.title')}</Text>
      <Text style={styles.subtitle}>{i18n.t('nav.myTicket')}</Text>

      <View style={styles.card}>
        {step === 'phone' && (
          <>
            <Text style={styles.label}>{i18n.t('auth.phoneLabel')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder={i18n.t('auth.phonePlaceholder')}
              placeholderTextColor={tokens.colors.inkFaint}
              keyboardType="phone-pad"
              testID="phone-input"
              accessibilityLabel={i18n.t('auth.phoneLabel')}
            />

            <View style={styles.consentRow} testID="uemoa-consent-row">
              <Switch
                value={uemoa}
                onValueChange={setUemoa}
                trackColor={{ true: tokens.colors.brand, false: tokens.colors.hairline }}
                thumbColor={tokens.colors.surface1}
                testID="uemoa-switch"
                accessibilityLabel={i18n.t('auth.uemoa_consent')}
              />
              <Text style={styles.consentText}>{i18n.t('auth.uemoa_consent')}</Text>
            </View>

            {!uemoa && (
              <Text style={styles.consentRequired} testID="uemoa-required">
                {i18n.t('auth.uemoa_required')}
              </Text>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, !uemoa && styles.buttonDisabled]}
              onPress={handleSendOtp}
              disabled={!uemoa || isLoading}
              activeOpacity={0.85}
              testID="send-otp-button"
              accessibilityLabel={i18n.t('auth.sendOtp')}
            >
              <Text style={styles.buttonText}>{i18n.t('auth.sendOtp')}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'otp' && (
          <>
            <Text style={styles.label}>{i18n.t('auth.otpLabel')}</Text>
            <TextInput
              style={styles.input}
              value={otp}
              onChangeText={setOtp}
              placeholder={i18n.t('auth.otpPlaceholder')}
              placeholderTextColor={tokens.colors.inkFaint}
              keyboardType="numeric"
              maxLength={6}
              testID="otp-input"
              accessibilityLabel={i18n.t('auth.otpLabel')}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={styles.button}
              onPress={handleVerify}
              disabled={isLoading}
              activeOpacity={0.85}
              testID="verify-otp-button"
              accessibilityLabel={i18n.t('auth.verifyOtp')}
            >
              <Text style={styles.buttonText}>{i18n.t('auth.verifyOtp')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.surface0,
  },
  container: {
    flexGrow: 1,
    padding: tokens.spacing.xl,
  },
  header: {
    marginTop: tokens.spacing.md,
    marginBottom: tokens.spacing.xxl,
    alignItems: 'flex-end',
  },
  brandMark: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 3,
    color: tokens.colors.brand,
    marginBottom: tokens.spacing.md,
  },
  title: {
    fontSize: tokens.fontSize['2xl'],
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.5,
    marginBottom: tokens.spacing.xs,
  },
  subtitle: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.xxl,
  },
  card: {
    backgroundColor: tokens.colors.surface1,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.xl,
    ...tokens.shadow.card,
  },
  label: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
    fontWeight: '600',
    marginBottom: tokens.spacing.sm,
  },
  input: {
    minHeight: tokens.minTouchTarget + 6,
    backgroundColor: tokens.colors.surface2,
    borderWidth: 1,
    borderColor: tokens.colors.hairline,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.lg,
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkStrong,
    marginBottom: tokens.spacing.lg,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: tokens.spacing.sm,
  },
  consentText: {
    flex: 1,
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
    marginLeft: tokens.spacing.md,
    lineHeight: 20,
  },
  consentRequired: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.danger,
    marginBottom: tokens.spacing.md,
  },
  errorText: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.danger,
    marginBottom: tokens.spacing.md,
  },
  button: {
    backgroundColor: tokens.colors.brand,
    minHeight: tokens.minTouchTarget + 8,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: tokens.spacing.lg,
    ...tokens.shadow.brand,
  },
  buttonDisabled: {
    backgroundColor: tokens.colors.surface2,
    opacity: 0.7,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: tokens.colors.brandContrast,
    fontSize: tokens.fontSize.md,
    fontWeight: '700',
  },
});
