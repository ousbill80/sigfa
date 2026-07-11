// history-mmkv.ts — MOB-005
// Persistance MMKV de l'historique des tickets (paginé localement)
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'sigfa-ticket-history' });
const HISTORY_KEY = 'ticket_history';
const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 heures

export interface HistoryEntry {
  trackingId: string;
  displayNumber: string;
  date: string;
  status: 'served' | 'cancelled' | 'waiting' | 'called';
  rating?: number;
  comment?: string;
}

/**
 * Ajoute une entrée à l'historique MMKV.
 * L'historique est trié par date DESC (plus récent en premier).
 */
export function writeHistoryEntry(entry: HistoryEntry): void {
  const existing = readHistory();
  // Mettre à jour si déjà présent (par trackingId), sinon ajouter
  const idx = existing.findIndex(e => e.trackingId === entry.trackingId);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.unshift(entry); // plus récent en premier
  }
  storage.set(HISTORY_KEY, JSON.stringify(existing));
}

/**
 * Lit l'historique complet depuis MMKV.
 */
export function readHistory(): HistoryEntry[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Supprime tout l'historique.
 */
export function clearHistory(): void {
  storage.delete(HISTORY_KEY);
}

/**
 * Retourne true si un ticket DONE est dans la fenêtre de feedback 24h
 * et n'a pas encore reçu de feedback (rating absent).
 */
export function hasPendingFeedback(entry: HistoryEntry): boolean {
  if (entry.status !== 'served') return false;
  if (entry.rating !== undefined) return false;
  const entryDate = new Date(entry.date).getTime();
  const now = Date.now();
  return now - entryDate < FEEDBACK_WINDOW_MS;
}

/**
 * Retourne les entrées qui ont un feedback en attente dans la fenêtre 24h.
 */
export function getPendingFeedbackEntries(): HistoryEntry[] {
  return readHistory().filter(hasPendingFeedback);
}
