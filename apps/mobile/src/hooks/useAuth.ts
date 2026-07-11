// useAuth.ts — MOB-001
// Hook d'authentification légère OTP
import { useState, useCallback } from 'react';
import { requestOtp, verifyOtp } from '@/services/auth';

export type AuthStep = 'phone' | 'otp' | 'authenticated';

export interface AuthState {
  step: AuthStep;
  phone: string;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  setPhone: (phone: string) => void;
  sendOtp: () => Promise<void>;
  verifyCode: (code: string) => Promise<boolean>;
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    step: 'phone',
    phone: '',
    isLoading: false,
    error: null,
  });

  const setPhone = useCallback((phone: string) => {
    setState(prev => ({ ...prev, phone, error: null }));
  }, []);

  const sendOtp = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      await requestOtp(state.phone);
      setState(prev => ({ ...prev, step: 'otp', isLoading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setState(prev => ({ ...prev, isLoading: false, error: message }));
    }
  }, [state.phone]);

  const verifyCode = useCallback(async (code: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const ok = await verifyOtp(state.phone, code);
      if (ok) {
        setState(prev => ({ ...prev, step: 'authenticated', isLoading: false }));
      } else {
        setState(prev => ({ ...prev, isLoading: false, error: 'Code incorrect' }));
      }
      return ok;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setState(prev => ({ ...prev, isLoading: false, error: message }));
      return false;
    }
  }, [state.phone]);

  const logout = useCallback(() => {
    setState({ step: 'phone', phone: '', isLoading: false, error: null });
  }, []);

  return { ...state, setPhone, sendOtp, verifyCode, logout };
}
