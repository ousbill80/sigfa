// api.ts — MOB-001
// Wrapper client @sigfa/contracts pour l'app mobile
// Note: utilise une URL mock en dev, la vraie URL en prod

const PUBLIC_API_BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface TicketStatus {
  trackingId: string;
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
}

/**
 * Récupère le statut d'un ticket par son trackingId.
 * Utilise l'endpoint public /public/tickets/{trackingId}.
 */
export async function fetchTicketStatus(trackingId: string): Promise<TicketStatus> {
  const url = `${PUBLIC_API_BASE_URL}/public/tickets/${trackingId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Ticket non trouvé: ${response.status}`);
  }

  const data = await response.json() as TicketStatus;
  return data;
}
