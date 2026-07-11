// useNetworkStatus.ts — MOB-001
// Hook React pour l'état réseau via @react-native-community/netinfo
import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    // addEventListener fires synchronously with the current state in React Native,
    // so it covers both initial state and subsequent changes.
    // Avoid a separate NetInfo.fetch() to prevent an out-of-act async state update
    // in tests (the .then() callback would fire as a microtask outside act()).
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setStatus({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
      });
    });

    return unsubscribe;
  }, []);

  return status;
}
