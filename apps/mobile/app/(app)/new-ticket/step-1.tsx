// app/(app)/new-ticket/step-1.tsx — Choix agence/service
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

// Données mock pour les tests
const MOCK_AGENCIES = [
  { id: 'agency-1', name: 'Agence Plateau' },
  { id: 'agency-2', name: 'Agence Cocody' },
];

const MOCK_SERVICES = [
  { id: 'service-1', name: 'Dépôt / Retrait' },
  { id: 'service-2', name: 'Compte courant' },
];

export default function Step1Screen(): React.JSX.Element {
  const router = useRouter();
  const [selectedAgency, setSelectedAgency] = React.useState('');
  const [selectedService, setSelectedService] = React.useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{i18n.t('ticket.step1Title')}</Text>

      <Text style={styles.sectionTitle}>{i18n.t('ticket.agency')}</Text>
      {MOCK_AGENCIES.map(agency => (
        <TouchableOpacity
          key={agency.id}
          style={[styles.option, selectedAgency === agency.id && styles.optionSelected]}
          onPress={() => setSelectedAgency(agency.id)}
          testID={`agency-${agency.id}`}
          accessibilityLabel={agency.name}
        >
          <Text style={styles.optionText}>{agency.name}</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>{i18n.t('ticket.service')}</Text>
      {MOCK_SERVICES.map(service => (
        <TouchableOpacity
          key={service.id}
          style={[styles.option, selectedService === service.id && styles.optionSelected]}
          onPress={() => setSelectedService(service.id)}
          testID={`service-${service.id}`}
          accessibilityLabel={service.name}
        >
          <Text style={styles.optionText}>{service.name}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={[
          styles.button,
          (!selectedAgency || !selectedService) && styles.buttonDisabled,
        ]}
        onPress={() => router.push('/(app)/new-ticket/step-2')}
        disabled={!selectedAgency || !selectedService}
        testID="next-step-1"
        accessibilityLabel={i18n.t('ticket.next')}
      >
        <Text style={styles.buttonText}>{i18n.t('ticket.next')}</Text>
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
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.4,
    marginBottom: tokens.spacing.xl,
  },
  sectionTitle: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
    fontWeight: '600',
    marginBottom: tokens.spacing.md,
    marginTop: tokens.spacing.lg,
  },
  option: {
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.hairline,
    backgroundColor: tokens.colors.surface1,
    borderRadius: tokens.radius.lg,
    marginBottom: tokens.spacing.md,
    minHeight: tokens.minTouchTarget + 8,
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: tokens.colors.brand,
    borderWidth: 1.5,
    backgroundColor: tokens.colors.brandSoft,
  },
  optionText: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkStrong,
    fontWeight: '600',
  },
  button: {
    backgroundColor: tokens.colors.brand,
    minHeight: tokens.minTouchTarget + 8,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: tokens.spacing.xl,
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
