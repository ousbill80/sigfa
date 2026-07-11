// __tests__/mob-001-use-auth-hook.test.tsx
// MOB-001: useAuth hook — logique d'authentification
import { renderHook, act } from '@testing-library/react-native';
import { useAuth } from '../src/hooks/useAuth';

// Mock des services
jest.mock('../src/services/auth', () => ({
  requestOtp: jest.fn().mockResolvedValue(undefined),
  verifyOtp: jest.fn().mockResolvedValue(true),
}));

import { requestOtp, verifyOtp } from '../src/services/auth';
const mockRequestOtp = requestOtp as jest.MockedFunction<typeof requestOtp>;
const mockVerifyOtp = verifyOtp as jest.MockedFunction<typeof verifyOtp>;

describe('MOB-001: useAuth hook — logique d\'authentification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('état initial est phone', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.step).toBe('phone');
    expect(result.current.phone).toBe('');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('setPhone met à jour le numéro', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    expect(result.current.phone).toBe('+2250102030405');
  });

  test('sendOtp passe en état otp après succès', async () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    await act(async () => {
      await result.current.sendOtp();
    });
    expect(result.current.step).toBe('otp');
    expect(mockRequestOtp).toHaveBeenCalledWith('+2250102030405');
  });

  test('sendOtp définit une erreur en cas d\'échec', async () => {
    mockRequestOtp.mockRejectedValueOnce(new Error('Réseau indisponible'));
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    await act(async () => {
      await result.current.sendOtp();
    });
    expect(result.current.error).toBe('Réseau indisponible');
    expect(result.current.step).toBe('phone');
  });

  test('verifyCode avec code correct passe en authenticated', async () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    let success: boolean = false;
    await act(async () => {
      success = await result.current.verifyCode('123456');
    });
    expect(success).toBe(true);
    expect(result.current.step).toBe('authenticated');
  });

  test('verifyCode avec mauvais code définit une erreur', async () => {
    mockVerifyOtp.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    let success: boolean = true;
    await act(async () => {
      success = await result.current.verifyCode('000000');
    });
    expect(success).toBe(false);
    expect(result.current.error).toBe('Code incorrect');
  });

  test('logout réinitialise l\'état', async () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    await act(async () => {
      await result.current.sendOtp();
    });
    act(() => {
      result.current.logout();
    });
    expect(result.current.step).toBe('phone');
    expect(result.current.phone).toBe('');
  });

  test('sendOtp gère les erreurs non-Error (string thrown)', async () => {
    // Throw a non-Error value to hit the else branch
    mockRequestOtp.mockRejectedValueOnce('string error');
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    await act(async () => {
      await result.current.sendOtp();
    });
    expect(result.current.error).toBe('Erreur inconnue');
  });

  test('verifyCode gère les erreurs non-Error (string thrown)', async () => {
    mockVerifyOtp.mockRejectedValueOnce('non-error');
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setPhone('+2250102030405');
    });
    let success: boolean = true;
    await act(async () => {
      success = await result.current.verifyCode('123456');
    });
    expect(success).toBe(false);
    expect(result.current.error).toBe('Erreur inconnue');
  });
});
