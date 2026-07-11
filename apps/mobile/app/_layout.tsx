// app/_layout.tsx — Root layout Expo Router v3
import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
  );
}
