// useOfflineTicketState.ts — MOB-004
// Lecture état ticket depuis MMKV quand offline
// + logique d'alerte "≤ 2 personnes devant vous"
import { readTicketState, type TicketMMKVState } from '@/services/ticket-mmkv';

export interface UseOfflineTicketStateOptions {
  isOffline: boolean;
}

export interface UseOfflineTicketStateReturn {
  ticket: TicketMMKVState | null;
  isOffline: boolean;
  shouldAlertTwoPersons: (position: number) => boolean;
}

/**
 * useOfflineTicketState — lit l'état du ticket depuis MMKV quand offline.
 * Expose shouldAlertTwoPersons pour déclencher la notification push.
 */
export function useOfflineTicketState({
  isOffline,
}: UseOfflineTicketStateOptions): UseOfflineTicketStateReturn {
  // Toujours lire depuis MMKV pour avoir la dernière position connue
  const ticket = readTicketState();

  /**
   * Retourne true si la position ≤ 2 → déclenchement de la notification push.
   */
  function shouldAlertTwoPersons(position: number): boolean {
    return position <= 2;
  }

  return {
    ticket,
    isOffline,
    shouldAlertTwoPersons,
  };
}
