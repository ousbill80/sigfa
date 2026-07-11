// __tests__/mob-001-offline.test.tsx
// MOB-001: état offline — badge discret visible quand NetInfo offline
import React from 'react';
import { render } from '@testing-library/react-native';
import { OfflineBadge } from '../src/components/OfflineBadge';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';

// Mock du hook réseau
jest.mock('../src/hooks/useNetworkStatus');

const mockUseNetworkStatus = useNetworkStatus as jest.MockedFunction<typeof useNetworkStatus>;

describe('MOB-001: état offline — badge discret visible quand NetInfo offline', () => {
  test('badge offline NON visible quand connecté', () => {
    mockUseNetworkStatus.mockReturnValue({ isConnected: true, isInternetReachable: true });
    const { queryByTestId } = render(<OfflineBadge />);
    expect(queryByTestId('offline-badge')).toBeNull();
  });

  test('badge offline VISIBLE quand déconnecté', () => {
    mockUseNetworkStatus.mockReturnValue({ isConnected: false, isInternetReachable: false });
    const { getByTestId } = render(<OfflineBadge />);
    expect(getByTestId('offline-badge')).toBeTruthy();
  });

  test('badge offline VISIBLE quand isConnected=false seulement', () => {
    mockUseNetworkStatus.mockReturnValue({ isConnected: false, isInternetReachable: true });
    const { getByTestId } = render(<OfflineBadge />);
    expect(getByTestId('offline-badge')).toBeTruthy();
  });

  test('badge affiche le texte "Hors ligne"', () => {
    mockUseNetworkStatus.mockReturnValue({ isConnected: false, isInternetReachable: false });
    const { getByText } = render(<OfflineBadge />);
    expect(getByText('Hors ligne')).toBeTruthy();
  });
});
