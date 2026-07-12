// __tests__/mob-002-ticket-flow.test.tsx
// MOB-002: useTicketFlow — hook de logique 3 étapes
// (S8 : enqueue passe par le store chiffré → gate initSecureStorage())
import { renderHook, act } from '@testing-library/react-native';
import { useTicketFlow } from '../src/hooks/useTicketFlow';
import { initSecureStorage, resetSecureStorageForTests } from '../src/services/secure-storage';

beforeEach(async () => {
  resetSecureStorageForTests();
  await initSecureStorage();
});

describe('MOB-002: useTicketFlow — hook de logique 3 étapes', () => {
  test('état initial est étape 1', () => {
    const { result } = renderHook(() => useTicketFlow());
    expect(result.current.step).toBe(1);
    expect(result.current.agencyId).toBe('');
    expect(result.current.serviceId).toBe('');
    expect(result.current.uemoaConsent).toBe(false);
  });

  test('setAgency met à jour agencyId', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setAgency('agency-1');
    });
    expect(result.current.agencyId).toBe('agency-1');
  });

  test('setService met à jour serviceId', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setService('service-1');
    });
    expect(result.current.serviceId).toBe('service-1');
  });

  test('setPhone met à jour phone', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    expect(result.current.phone).toBe('+2250102030405');
  });

  test('setUemoaConsent met à jour uemoaConsent', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setUemoaConsent(true);
    });
    expect(result.current.uemoaConsent).toBe(true);
  });

  test('goToStep2 échoue sans agence et service', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.goToStep2();
    });
    expect(result.current.step).toBe(1);
    expect(result.current.error).toBeTruthy();
  });

  test('goToStep2 réussit avec agence et service', () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setAgency('agency-1');
      result.current.setService('service-1');
    });
    act(() => {
      result.current.goToStep2();
    });
    expect(result.current.step).toBe(2);
    expect(result.current.error).toBeNull();
  });

  test('goToStep3 échoue sans consentement UEMOA', async () => {
    const { result } = renderHook(() => useTicketFlow());
    await act(async () => {
      await result.current.goToStep3();
    });
    expect(result.current.step).toBe(1);
    expect(result.current.error).toBeTruthy();
  });

  test('goToStep3 réussit avec consentement UEMOA', async () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setUemoaConsent(true);
      result.current.setAgency('agency-1');
      result.current.setService('service-1');
    });
    await act(async () => {
      await result.current.goToStep3();
    });
    expect(result.current.step).toBe(3);
    expect(result.current.trackingId).toBeTruthy();
    expect(result.current.trackingId).toHaveLength(21);
  });

  test('idempotencyKey est un nanoid(21) unique', () => {
    const { result: r1 } = renderHook(() => useTicketFlow());
    const { result: r2 } = renderHook(() => useTicketFlow());
    expect(r1.current.idempotencyKey).toHaveLength(21);
    expect(r2.current.idempotencyKey).toHaveLength(21);
    expect(r1.current.idempotencyKey).not.toBe(r2.current.idempotencyKey);
  });

  test('reset réinitialise l\'état', async () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setAgency('agency-1');
      result.current.setService('service-1');
      result.current.setUemoaConsent(true);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.step).toBe(1);
    expect(result.current.agencyId).toBe('');
    expect(result.current.uemoaConsent).toBe(false);
  });
});
