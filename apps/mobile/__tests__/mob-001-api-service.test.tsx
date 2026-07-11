// __tests__/mob-001-api-service.test.tsx
// MOB-001: service API — fetchTicketStatus mock
import { fetchTicketStatus, type TicketStatus } from '../src/services/api';

// Mock global fetch
const mockFetch = jest.fn();
(globalThis as typeof globalThis & { fetch: typeof jest.fn }).fetch = mockFetch;

describe('MOB-001: service API — fetchTicketStatus mock', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  test('fetchTicketStatus retourne le statut d\'un ticket', async () => {
    const mockTicket: TicketStatus = {
      trackingId: 'ABC123',
      displayNumber: 'G-001',
      position: 3,
      estimatedWaitMinutes: 15,
      status: 'waiting',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTicket,
    });

    const result = await fetchTicketStatus('ABC123');
    expect(result.trackingId).toBe('ABC123');
    expect(result.displayNumber).toBe('G-001');
    expect(result.status).toBe('waiting');
  });

  test('fetchTicketStatus appelle la bonne URL', async () => {
    const mockTicket: TicketStatus = {
      trackingId: 'TEST001',
      displayNumber: 'A-042',
      position: 1,
      estimatedWaitMinutes: 5,
      status: 'waiting',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTicket,
    });

    await fetchTicketStatus('TEST001');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/tickets/TEST001')
    );
  });

  test('fetchTicketStatus lève une erreur si la réponse n\'est pas ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(fetchTicketStatus('UNKNOWN')).rejects.toThrow('Ticket non trouvé: 404');
  });

  test('TicketStatus a les bons statuts possibles', () => {
    const statuses: TicketStatus['status'][] = ['waiting', 'called', 'served', 'cancelled'];
    expect(statuses).toHaveLength(4);
  });
});
