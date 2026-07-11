// app/(app)/_layout.tsx — App layout (authenticated)
import React from 'react';
import { Stack } from 'expo-router';

export default function AppLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Accueil' }} />
      <Stack.Screen name="ticket/[trackingId]" options={{ title: 'Mon ticket' }} />
      <Stack.Screen name="new-ticket/step-1" options={{ title: 'Nouveau ticket - Étape 1' }} />
      <Stack.Screen name="new-ticket/step-2" options={{ title: 'Nouveau ticket - Étape 2' }} />
      <Stack.Screen name="new-ticket/step-3" options={{ title: 'Confirmation' }} />
    </Stack>
  );
}
