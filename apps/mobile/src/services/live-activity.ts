// live-activity.ts — MOB-003
// Structure Live Activity iOS derrière flag EXPO_PUBLIC_LIVE_ACTIVITY=false
// Activation EAS = story post-F4. Critère CI = pas de crash quand flag off.

const isLiveActivityEnabled = (): boolean => {
  return process.env['EXPO_PUBLIC_LIVE_ACTIVITY'] === 'true';
};

export interface LiveActivityPayload {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
}

export interface LiveActivityUpdatePayload {
  position: number;
  estimatedWaitMinutes: number;
}

/**
 * LiveActivityService — gère les Live Activities iOS (ActivityKit).
 * Derrière le flag EXPO_PUBLIC_LIVE_ACTIVITY=false en F4.
 * Quand le flag est false (défaut), toutes les méthodes sont no-op.
 */
export class LiveActivityService {
  private activityId: string | null = null;

  /**
   * Démarre une Live Activity pour le ticket vivant.
   * No-op si EXPO_PUBLIC_LIVE_ACTIVITY !== 'true'.
   */
  start(payload: LiveActivityPayload): void {
    if (!isLiveActivityEnabled()) {
      return;
    }
    // Structure pour intégration future avec ActivityKit via module natif Expo
    // En F4 : stub uniquement — l'activation EAS est une story post-F4
    this.activityId = `live-activity-${payload.displayNumber}-${Date.now()}`;
  }

  /**
   * Met à jour la Live Activity avec la nouvelle position et estimation.
   * No-op si EXPO_PUBLIC_LIVE_ACTIVITY !== 'true' ou si aucune activité en cours.
   */
  update(payload: LiveActivityUpdatePayload): void {
    if (!isLiveActivityEnabled() || !this.activityId) {
      return;
    }
    // Stub pour intégration future
    void payload;
  }

  /**
   * Arrête et supprime la Live Activity.
   * No-op si EXPO_PUBLIC_LIVE_ACTIVITY !== 'true' ou si aucune activité en cours.
   */
  stop(): void {
    if (!isLiveActivityEnabled() || !this.activityId) {
      return;
    }
    this.activityId = null;
  }

  get isActive(): boolean {
    return this.activityId !== null;
  }
}

// Singleton
let _instance: LiveActivityService | null = null;

export function getLiveActivityService(): LiveActivityService {
  if (!_instance) {
    _instance = new LiveActivityService();
  }
  return _instance;
}
