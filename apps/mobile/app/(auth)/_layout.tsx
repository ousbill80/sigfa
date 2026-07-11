// app/(auth)/_layout.tsx — Auth layout
import React from 'react';
import { Stack } from 'expo-router';

export default function AuthLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="phone" options={{ title: 'Connexion' }} />
    </Stack>
  );
}
