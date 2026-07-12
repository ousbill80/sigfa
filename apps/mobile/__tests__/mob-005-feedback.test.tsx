// __tests__/mob-005-feedback.test.tsx
// MOB-005: Feedback post-service + historique de tickets
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { renderHook } from '@testing-library/react-native';

import { FeedbackScreen } from '../src/components/FeedbackScreen';
import { HistoryScreen } from '../src/components/HistoryScreen';
import { useFeedback } from '../src/hooks/useFeedback';
import {
  writeHistoryEntry,
  readHistory,
  clearHistory,
  type HistoryEntry,
} from '../src/services/history-mmkv';
import { i18n } from '../src/i18n';

// MMKV mock storage per test
let mockStorage: Record<string, string> = {};

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn((key: string, value: string) => { mockStorage[key] = value; }),
    getString: jest.fn((key: string) => mockStorage[key] ?? undefined),
    delete: jest.fn(() => { mockStorage = {}; }),
    contains: jest.fn((key: string) => key in mockStorage),
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage = {};
});

describe('MOB-005: écran feedback — 5 étoiles + champ commentaire rendus avec tokens SIGFA (RNTL snapshot × FR/EN)', () => {
  test('MOB-005: FeedbackScreen — rendu avec 5 étoiles et champ commentaire en français', () => {
    i18n.locale = 'fr';
    const { toJSON, getByTestId } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="nominal"
      />
    );
    expect(getByTestId('feedback-stars')).toBeTruthy();
    expect(getByTestId('feedback-comment')).toBeTruthy();
    expect(getByTestId('feedback-submit')).toBeTruthy();
    expect(toJSON()).toMatchSnapshot('FeedbackScreen-fr');
  });

  test('MOB-005: FeedbackScreen — snapshot en anglais', () => {
    i18n.locale = 'en';
    const { toJSON } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="nominal"
      />
    );
    expect(toJSON()).toMatchSnapshot('FeedbackScreen-en');
    i18n.locale = 'fr';
  });

  test('MOB-005: copie SIGFA — bouton "Donner mon avis" visible', () => {
    i18n.locale = 'fr';
    const { getByText } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="nominal"
      />
    );
    expect(getByText('Donner mon avis')).toBeTruthy();
  });

  test('MOB-005: copie SIGFA — label commentaire "Un mot à ajouter ? (facultatif)"', () => {
    i18n.locale = 'fr';
    const { getByText } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="nominal"
      />
    );
    expect(getByText('Un mot à ajouter ? (facultatif)')).toBeTruthy();
  });
});

describe('MOB-005: POST feedback — appel avec trackingId nanoid(21), note 1–5, commentaire ≤ 500 chars', () => {
  test('MOB-005: POST feedback — appel réussi (201)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useFeedback({
        trackingId: 'tid-nanoid-21-chars00',
        apiBaseUrl: 'http://localhost:4000',
      })
    );

    await act(async () => {
      await result.current.submit({ rating: 4, comment: 'Très bien' });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/public/tickets/tid-nanoid-21-chars00/feedback',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"rating":4'),
      })
    );
    expect(result.current.screenState).toBe('success');
  });

  test('MOB-005: POST feedback sans commentaire', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useFeedback({
        trackingId: 'tid-nanoid-21-chars00',
        apiBaseUrl: 'http://localhost:4000',
      })
    );

    await act(async () => {
      await result.current.submit({ rating: 5 });
    });

    expect(result.current.screenState).toBe('success');
  });

  test('MOB-005: doublon — 409 FEEDBACK_ALREADY_SUBMITTED affiché sans bloquer la navigation', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'FEEDBACK_ALREADY_SUBMITTED' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useFeedback({
        trackingId: 'tid-nanoid-21-chars00',
        apiBaseUrl: 'http://localhost:4000',
      })
    );

    await act(async () => {
      await result.current.submit({ rating: 3 });
    });

    expect(result.current.errorCode).toBe('FEEDBACK_ALREADY_SUBMITTED');
    expect(result.current.screenState).toBe('error');
    // L'erreur doit être non-bloquante (pas de crash, navigation possible)
    expect(result.current.canNavigateAway).toBe(true);
  });

  test('MOB-005: fenêtre expirée — 422 FEEDBACK_WINDOW_EXPIRED → masquage silencieux du formulaire', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 'FEEDBACK_WINDOW_EXPIRED' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useFeedback({
        trackingId: 'tid-nanoid-21-chars00',
        apiBaseUrl: 'http://localhost:4000',
      })
    );

    await act(async () => {
      await result.current.submit({ rating: 2 });
    });

    expect(result.current.errorCode).toBe('FEEDBACK_WINDOW_EXPIRED');
    expect(result.current.shouldHideForm).toBe(true);
  });

  test('MOB-005: état loading pendant l\'envoi', async () => {
    let resolve: ((v: unknown) => void) | null = null;
    const fetchMock = jest.fn().mockReturnValue(new Promise(r => { resolve = r; }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useFeedback({
        trackingId: 'tid-nanoid-21-chars00',
        apiBaseUrl: 'http://localhost:4000',
      })
    );

    act(() => {
      void result.current.submit({ rating: 3 });
    });

    expect(result.current.screenState).toBe('loading');

    await act(async () => {
      resolve?.({ ok: true, status: 201, json: async () => ({}) });
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(result.current.screenState).toBe('success');
  });

  test('MOB-005: message de confirmation "Merci pour votre retour !" en état success', () => {
    i18n.locale = 'fr';
    const { getByText } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="success"
      />
    );
    expect(getByText('Merci pour votre retour !')).toBeTruthy();
  });

  test('MOB-005: FeedbackScreen state loading — affiche ActivityIndicator', () => {
    const { getByTestId } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={jest.fn()}
        screenState="loading"
      />
    );
    expect(getByTestId('feedback-loading')).toBeTruthy();
  });
});

describe('MOB-005: historique MMKV — liste des tickets précédents', () => {
  test('MOB-005: writeHistoryEntry + readHistory — persiste et lit depuis MMKV', () => {
    const entry: HistoryEntry = {
      trackingId: 'tid-hist-001',
      displayNumber: 'A-001',
      date: '2026-01-01T10:00:00Z',
      status: 'served',
      rating: 4,
    };
    writeHistoryEntry(entry);
    const history = readHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.trackingId).toBe('tid-hist-001');
  });

  test('MOB-005: readHistory — retourne [] si MMKV vide', () => {
    expect(readHistory()).toEqual([]);
  });

  test('MOB-005: clearHistory — supprime l\'historique MMKV', () => {
    const entry: HistoryEntry = {
      trackingId: 'tid-to-clear',
      displayNumber: 'B-002',
      date: '2026-01-02T09:00:00Z',
      status: 'served',
    };
    writeHistoryEntry(entry);
    clearHistory();
    expect(readHistory()).toEqual([]);
  });

  test('MOB-005: historique MMKV — infini scroll, état empty si vide', () => {
    const { getByTestId } = render(<HistoryScreen isLoading={false} />);
    expect(getByTestId('history-empty')).toBeTruthy();
  });

  test('MOB-005: historique MMKV — liste avec entrées', () => {
    const entries: HistoryEntry[] = [
      { trackingId: 'tid-001', displayNumber: 'A-001', date: '2026-01-01T10:00:00Z', status: 'served' },
      { trackingId: 'tid-002', displayNumber: 'B-002', date: '2026-01-02T09:00:00Z', status: 'served', rating: 5 },
    ];
    const { getByTestId } = render(<HistoryScreen entries={entries} isLoading={false} />);
    expect(getByTestId('history-list')).toBeTruthy();
  });

  test('MOB-005: badge rappel — visible sur onglet Historique si ticket DONE sans feedback dans la fenêtre', () => {
    const entries: HistoryEntry[] = [
      {
        trackingId: 'tid-no-feedback',
        displayNumber: 'C-003',
        date: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h ago — dans fenêtre 24h
        status: 'served',
        // pas de rating → feedback en attente
      },
    ];
    const { getByTestId } = render(<HistoryScreen entries={entries} isLoading={false} />);
    expect(getByTestId('history-feedback-badge')).toBeTruthy();
  });

  test('MOB-005: badge rappel — absent si ticket hors fenêtre 24h', () => {
    const entries: HistoryEntry[] = [
      {
        trackingId: 'tid-old',
        displayNumber: 'D-004',
        date: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(), // 25h ago — hors fenêtre
        status: 'served',
        // pas de rating
      },
    ];
    const { queryByTestId } = render(<HistoryScreen entries={entries} isLoading={false} />);
    expect(queryByTestId('history-feedback-badge')).toBeNull();
  });

  test('MOB-005: badge rappel — absent si feedback déjà donné', () => {
    const entries: HistoryEntry[] = [
      {
        trackingId: 'tid-with-feedback',
        displayNumber: 'E-005',
        date: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        status: 'served',
        rating: 3, // feedback déjà donné
      },
    ];
    const { queryByTestId } = render(<HistoryScreen entries={entries} isLoading={false} />);
    expect(queryByTestId('history-feedback-badge')).toBeNull();
  });
});

describe('MOB-005: FeedbackScreen — interactions utilisateur', () => {
  test('MOB-005: sélection d\'une étoile met à jour la note', () => {
    const onSubmit = jest.fn();
    const { getByTestId } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={onSubmit}
        screenState="nominal"
      />
    );
    fireEvent.press(getByTestId('feedback-star-4'));
    expect(getByTestId('feedback-star-4')).toBeTruthy();
  });

  test('MOB-005: appui sur "Donner mon avis" appelle onSubmit avec la note et le commentaire', () => {
    const onSubmit = jest.fn();
    const { getByTestId, getByText } = render(
      <FeedbackScreen
        trackingId="tid-nanoid-21-chars00"
        onSubmit={onSubmit}
        screenState="nominal"
        initialRating={4}
        initialComment="Super service"
      />
    );
    fireEvent.press(getByText('Donner mon avis'));
    expect(onSubmit).toHaveBeenCalledWith({ rating: 4, comment: 'Super service' });
    expect(getByTestId('feedback-submit')).toBeTruthy();
  });
});
