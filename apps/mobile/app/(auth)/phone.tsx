// app/(auth)/phone.tsx — Écran saisie téléphone + OTP
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{i18n.t('auth.title')}</Text>

      {step === 'phone' && (
        <>
          <Text style={styles.label}>{i18n.t('auth.phoneLabel')}</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={i18n.t('auth.phonePlaceholder')}
            keyboardType="phone-pad"
            testID="phone-input"
            accessibilityLabel={i18n.t('auth.phoneLabel')}
          />

          <View style={styles.consentRow} testID="uemoa-consent-row">
            <Switch
              value={uemoa}
              onValueChange={setUemoa}
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
            testID="verify-otp-button"
            accessibilityLabel={i18n.t('auth.verifyOtp')}
          >
            <Text style={styles.buttonText}>{i18n.t('auth.verifyOtp')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: tokens.spacing.xl,
    backgroundColor: tokens.colors.surface0,
  },
  title: {
    fontSize: tokens.fontSize.title,
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
    marginBottom: tokens.spacing.xl,
  },
  label: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.sm,
  },
  input: {
    height: tokens.minTouchTarget,
    borderWidth: 1,
    borderColor: tokens.colors.inkSoft,
    borderRadius: tokens.radius.button,
    paddingHorizontal: tokens.spacing.md,
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkStrong,
    backgroundColor: tokens.colors.surface1,
    marginBottom: tokens.spacing.lg,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: tokens.spacing.sm,
  },
  consentText: {
    flex: 1,
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.inkSoft,
    marginLeft: tokens.spacing.sm,
  },
  consentRequired: {
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.danger,
    marginBottom: tokens.spacing.md,
  },
  errorText: {
    fontSize: tokens.fontSize.caption,
    color: tokens.colors.danger,
    marginBottom: tokens.spacing.md,
  },
  button: {
    backgroundColor: tokens.colors.brand,
    height: tokens.minTouchTarget,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: tokens.spacing.lg,
  },
  buttonDisabled: {
    backgroundColor: tokens.colors.inkSoft,
    opacity: 0.5,
  },
  buttonText: {
    color: tokens.colors.inkInverse,
    fontSize: tokens.fontSize.body,
    fontWeight: 'bold',
  },
});
