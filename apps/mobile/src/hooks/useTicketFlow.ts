// useTicketFlow.ts — MOB-002
// Hook logique 3 étapes de prise de ticket
import { useState, useCallback } from 'react';
import { nanoid } from 'nanoid/non-secure';
import { enqueue, type PendingTicket } from '@/services/offline-queue';

export interface TicketFlowState {
  step: 1 | 2 | 3;
  agencyId: string;
  serviceId: string;
  phone: string;
  uemoaConsent: boolean;
  idempotencyKey: string;
  trackingId: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseTicketFlowReturn extends TicketFlowState {
  setAgency: (agencyId: string) => void;
  setService: (serviceId: string) => void;
  setPhone: (phone: string) => void;
  setUemoaConsent: (consent: boolean) => void;
  goToStep2: () => void;
  goToStep3: () => Promise<void>;
  reset: () => void;
}

function initialState(): TicketFlowState {
  return {
    step: 1,
    agencyId: '',
    serviceId: '',
    phone: '',
    uemoaConsent: false,
    idempotencyKey: nanoid(21),
    trackingId: null,
    isLoading: false,
    error: null,
  };
}

export function useTicketFlow(): UseTicketFlowReturn {
  const [state, setState] = useState<TicketFlowState>(initialState);

  const setAgency = useCallback((agencyId: string) => {
    setState(prev => ({ ...prev, agencyId, error: null }));
  }, []);

  const setService = useCallback((serviceId: string) => {
    setState(prev => ({ ...prev, serviceId, error: null }));
  }, []);

  const setPhone = useCallback((phone: string) => {
    setState(prev => ({ ...prev, phone, error: null }));
  }, []);

  const setUemoaConsent = useCallback((consent: boolean) => {
    setState(prev => ({ ...prev, uemoaConsent: consent, error: null }));
  }, []);

  const goToStep2 = useCallback(() => {
    setState(prev => {
      if (!prev.agencyId || !prev.serviceId) {
        return { ...prev, error: 'Veuillez sélectionner une agence et un service' };
      }
      return { ...prev, step: 2, error: null };
    });
  }, []);

  const goToStep3 = useCallback(async () => {
    if (!state.uemoaConsent) {
      setState(prev => ({ ...prev, error: 'Le consentement UEMOA est requis' }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const pending: PendingTicket = {
      idempotencyKey: state.idempotencyKey,
      agencyId: state.agencyId,
      serviceId: state.serviceId,
      phone: state.phone,
      uemoaConsent: state.uemoaConsent,
      enqueuedAt: new Date().toISOString(),
    };

    // Enqueue offline (MMKV)
    enqueue(pending);

    // Générer un trackingId local (nanoid 21)
    const trackingId = nanoid(21);

    setState(prev => ({
      ...prev,
      step: 3,
      trackingId,
      isLoading: false,
    }));
  }, [state]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { ...state, setAgency, setService, setPhone, setUemoaConsent, goToStep2, goToStep3, reset };
}
