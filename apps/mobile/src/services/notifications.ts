// notifications.ts — MOB-003
// Notification persistante Android (canal TICKET_ACTIVE, priorité HIGH, non dismissable)
// + intégration Expo Notifications pour MOB-004

import { Platform } from 'react-native';

export interface TicketNotificationPayload {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  travelMinutes?: number;
}

const ANDROID_CHANNEL_ID = 'TICKET_ACTIVE';

/**
 * Configure le canal de notification Android TICKET_ACTIVE.
 * À appeler au démarrage de l'application.
 * No-op sur iOS.
 */
export async function setupAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // En test Jest, Platform.OS est 'ios' par défaut — safe no-op
  // En prod, on utiliserait expo-notifications pour créer le canal
  // Stub: la vraie implémentation utilisera setNotificationChannelAsync
}

/**
 * Affiche une notification persistante Android (non dismissable, priorité HIGH).
 * Canal: TICKET_ACTIVE.
 * No-op sur iOS (Live Activity gère la persistance).
 */
export function scheduleAndroidPersistentNotification(payload: TicketNotificationPayload): void {
  if (Platform.OS !== 'android') return;
  // Stub en F4 — intégration expo-notifications complète en RT-001
  void payload;
  void ANDROID_CHANNEL_ID;
}

/**
 * Annule la notification persistante Android.
 * Appelé quand le ticket est clôturé.
 */
export function cancelAndroidPersistentNotification(): void {
  if (Platform.OS !== 'android') return;
  // Stub en F4
}

/**
 * Envoie une notification push "≤ 2 personnes devant vous" via Expo Notifications + FCM.
 * MOB-004 utilise cette fonction.
 */
export async function schedulePositionAlert(payload: {
  position: number;
  travelMinutes?: number;
}): Promise<void> {
  if (payload.position > 2) return;
  // Stub en F4 — intégration expo-notifications + FCM complète en NOTIF-001
  void payload;
}

/**
 * Enregistre le device push via POST /notifications/devices.
 * MOB-004.
 */
export async function registerDevicePush(params: {
  token: string;
  platform: 'EXPO' | 'IOS' | 'ANDROID';
  apiBaseUrl: string;
  idempotencyKey?: string;
}): Promise<{ deviceId: string }> {
  const res = await fetch(`${params.apiBaseUrl}/notifications/devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.idempotencyKey ? { 'X-Idempotency-Key': params.idempotencyKey } : {}),
    },
    body: JSON.stringify({ token: params.token, platform: params.platform }),
  });

  if (!res.ok) {
    throw new Error(`register device failed: ${res.status}`);
  }

  const data = await res.json() as { deviceId: string };
  return data;
}

/**
 * Désenregistre le device push via DELETE /notifications/devices/{deviceId}.
 * MOB-004.
 */
export async function unregisterDevicePush(params: {
  deviceId: string;
  apiBaseUrl: string;
}): Promise<void> {
  const res = await fetch(`${params.apiBaseUrl}/notifications/devices/${params.deviceId}`, {
    method: 'DELETE',
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`unregister device failed: ${res.status}`);
  }
}
