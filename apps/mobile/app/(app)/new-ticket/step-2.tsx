// app/(app)/new-ticket/step-2.tsx — Confirmation + téléphone + opt-in UEMOA
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';
import { useTicketFlow } from '@/hooks/useTicketFlow';

export default function Step2Screen(): React.JSX.Element {
  const router = useRouter();
  const { phone, uemoaConsent, error, setPhone, setUemoaConsent, goToStep3, isLoading } =
    useTicketFlow();

  async function handleConfirm(): Promise<void> {
    if (!uemoaConsent) return;
    await goToStep3();
    router.push('/(app)/new-ticket/step-3');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{i18n.t('ticket.step2Title')}</Text>

      <Text style={styles.label}>{i18n.t('auth.phoneLabel')}</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={i18n.t('auth.phonePlaceholder')}
        keyboardType="phone-pad"
        testID="step2-phone-input"
        accessibilityLabel={i18n.t('auth.phoneLabel')}
      />

      <View style={styles.consentRow} testID="step2-uemoa-consent-row">
        <Switch
          value={uemoaConsent}
          onValueChange={setUemoaConsent}
          testID="step2-uemoa-switch"
          accessibilityLabel={i18n.t('auth.uemoa_consent')}
        />
        <Text style={styles.consentText}>{i18n.t('auth.uemoa_consent')}</Text>
      </View>

      {!uemoaConsent && (
        <Text style={styles.consentRequired} testID="step2-uemoa-required">
          {i18n.t('auth.uemoa_required')}
        </Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, !uemoaConsent && styles.buttonDisabled]}
        onPress={handleConfirm}
        disabled={!uemoaConsent || isLoading}
        testID="step2-confirm-button"
        accessibilityLabel={i18n.t('ticket.confirm')}
      >
        <Text style={styles.buttonText}>{i18n.t('ticket.confirm')}</Text>
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
