// usePushRegistration.ts — MOB-004
// Enregistrement device push via POST /notifications/devices (idempotent)
// + désenregistrement via DELETE /notifications/devices/{deviceId}
// 5 états: loading (enregistrement device), idle, empty, error, offline
import { useState, useEffect, useCallback } from 'react';
import { nanoid } from 'nanoid/non-secure';

export type PushRegistrationState = 'loading' | 'idle' | 'empty' | 'error' | 'offline';

export interface UsePushRegistrationOptions {
  apiBaseUrl: string;
  pushToken: string | null;
  platform?: 'EXPO' | 'IOS' | 'ANDROID';
}

export interface UsePushRegistrationReturn {
  deviceId: string | null;
  screenState: PushRegistrationState;
  error: string | null;
  unregister: () => Promise<void>;
}

export function usePushRegistration({
  apiBaseUrl,
  pushToken,
  platform = 'EXPO',
}: UsePushRegistrationOptions): UsePushRegistrationReturn {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [screenState, setScreenState] = useState<PushRegistrationState>('loading');
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (): Promise<void> => {
    // Sans opt-in push → idle, aucune fonctionnalité bloquée
    if (!pushToken) {
      setScreenState('idle');
      return;
    }

    setScreenState('loading');
    const idempotencyKey = nanoid(21);

    try {
      const res = await fetch(`${apiBaseUrl}/notifications/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ token: pushToken, platform }),
      });

      if (!res.ok) {
        setScreenState('error');
        setError(`Échec enregistrement: ${res.status}`);
        return;
      }

      const data = await res.json() as { deviceId: string };
      setDeviceId(data.deviceId);
      setError(null);
      setScreenState('idle');
    } catch {
      // Retry silencieux: passe en error, retry à la prochaine ouverture de l'app
      setScreenState('error');
      setError('Erreur réseau — retry au prochain lancement');
    }
  }, [apiBaseUrl, pushToken, platform]);

  useEffect(() => {
    void register();
  }, [register]);

  const unregister = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    try {
      await fetch(`${apiBaseUrl}/notifications/devices/${deviceId}`, {
        method: 'DELETE',
      });
      setDeviceId(null);
    } catch {
      // Silent failure — le device sera nettoyé côté serveur par TTL
    }
  }, [deviceId, apiBaseUrl]);

  return {
    deviceId,
    screenState,
    error,
    unregister,
  };
}
