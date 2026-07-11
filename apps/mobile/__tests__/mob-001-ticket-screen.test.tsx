// __tests__/mob-001-ticket-screen.test.tsx
// MOB-001: TicketScreen — suivi de ticket par trackingId
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TicketScreen from '../app/(app)/ticket/[trackingId]';
import { fetchTicketStatus } from '../src/services/api';

jest.mock('../src/services/api', () => ({
  fetchTicketStatus: jest.fn(),
}));

const mockFetchTicketStatus = fetchTicketStatus as jest.MockedFunction<typeof fetchTicketStatus>;

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({ trackingId: 'TEST-TRACK-123' })),
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Slot: 'Slot',
  Redirect: jest.fn(() => null),
}));

describe('MOB-001: TicketScreen — suivi de ticket par trackingId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('affiche l\'état loading au départ', () => {
    mockFetchTicketStatus.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByTestId } = render(<TicketScreen />);
    expect(getByTestId('screen-loading')).toBeTruthy();
  });

  test('affiche le ticket après chargement réussi', async () => {
    mockFetchTicketStatus.mockResolvedValueOnce({
      trackingId: 'TEST-TRACK-123',
      displayNumber: 'G-001',
      position: 2,
      estimatedWaitMinutes: 10,
      status: 'waiting',
    });

    const { getByTestId } = render(<TicketScreen />);
    await waitFor(() => {
      expect(getByTestId('ticket-display-number')).toBeTruthy();
    });
  });

  test('affiche l\'état erreur en cas d\'échec réseau', async () => {
    mockFetchTicketStatus.mockRejectedValueOnce(new Error('Network error'));

    const { getByTestId } = render(<TicketScreen />);
    await waitFor(() => {
      expect(getByTestId('screen-error')).toBeTruthy();
    });
  });
});
