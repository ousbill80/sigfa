// useFeedback.ts — MOB-005
// Hook logique pour le feedback post-service
// POST /public/tickets/{trackingId}/feedback
import { useState, useCallback } from 'react';

export type FeedbackScreenState = 'nominal' | 'loading' | 'success' | 'error' | 'empty';

export interface SubmitFeedbackParams {
  rating: number;
  comment?: string;
}

export interface UseFeedbackOptions {
  trackingId: string;
  apiBaseUrl: string;
}

export interface UseFeedbackReturn {
  screenState: FeedbackScreenState;
  errorCode: string | null;
  error: string | null;
  /** Si true, la navigation reste possible malgré l'erreur (ex: doublon 409) */
  canNavigateAway: boolean;
  /** Si true, masquer le formulaire silencieusement (fenêtre expirée 422) */
  shouldHideForm: boolean;
  submit: (params: SubmitFeedbackParams) => Promise<void>;
}

export function useFeedback({
  trackingId,
  apiBaseUrl,
}: UseFeedbackOptions): UseFeedbackReturn {
  const [screenState, setScreenState] = useState<FeedbackScreenState>('nominal');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canNavigateAway, setCanNavigateAway] = useState<boolean>(true);
  const [shouldHideForm, setShouldHideForm] = useState<boolean>(false);

  const submit = useCallback(async ({ rating, comment }: SubmitFeedbackParams): Promise<void> => {
    setScreenState('loading');
    setError(null);
    setErrorCode(null);

    try {
      const res = await fetch(`${apiBaseUrl}/public/tickets/${trackingId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment ?? '' }),
      });

      if (res.ok) {
        setScreenState('success');
        return;
      }

      let code: string | null = null;
      try {
        const body = await res.json() as { code?: string };
        code = body.code ?? null;
      } catch {
        // pas de body JSON
      }

      setErrorCode(code);

      if (res.status === 409) {
        // FEEDBACK_ALREADY_SUBMITTED — message non bloquant, navigation possible
        setScreenState('error');
        setError('Vous avez déjà donné votre avis');
        setCanNavigateAway(true);
        return;
      }

      if (res.status === 422 && code === 'FEEDBACK_WINDOW_EXPIRED') {
        // Fenêtre expirée → masquage silencieux du formulaire
        setScreenState('error');
        setShouldHideForm(true);
        setCanNavigateAway(true);
        return;
      }

      // Autre erreur (réseau KO → retry depuis MMKV)
      setScreenState('error');
      setError(`Erreur ${res.status}`);
      setCanNavigateAway(false);
    } catch {
      setScreenState('error');
      setError('Erreur réseau');
      setCanNavigateAway(false);
    }
  }, [trackingId, apiBaseUrl]);

  return {
    screenState,
    errorCode,
    error,
    canNavigateAway,
    shouldHideForm,
    submit,
  };
}
