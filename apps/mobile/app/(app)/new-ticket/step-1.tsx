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
    fontSize: tokens.fontSize.title,
    fontWeight: 'bold',
    color: tokens.colors.inkStrong,
    marginBottom: tokens.spacing.xl,
  },
  sectionTitle: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.sm,
    marginTop: tokens.spacing.lg,
  },
  option: {
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.inkSoft,
    borderRadius: tokens.radius.card,
    marginBottom: tokens.spacing.sm,
    minHeight: tokens.minTouchTarget,
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandSoft,
  },
  optionText: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.inkStrong,
  },
  button: {
    backgroundColor: tokens.colors.brand,
    height: tokens.minTouchTarget,
    borderRadius: tokens.radius.button,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: tokens.spacing.xl,
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
