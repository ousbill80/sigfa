/**
 * KIOSK-009 — FeedbackScreen.tsx
 * Feedback post-service sur borne : note 1-5 tactile + commentaire optionnel
 * (texte ou dictée vocale Web Speech API). Une décision par écran.
 *
 * Règles :
 *  - Éligibilité : ticket DONE ET fenêtre < 24 h (via GET /public/tickets).
 *    Sinon → écran non proposé, retour accueil silencieux.
 *  - POST /public/tickets/{trackingId}/feedback via @sigfa/contracts.
 *    Le contrat API-010 n'exige PAS d'X-Idempotency-Key : l'idempotence est
 *    gérée serveur via 409 FEEDBACK_ALREADY_SUBMITTED. On n'envoie donc que
 *    ce que le contrat exige (note + comment).
 *  - 409 FEEDBACK_ALREADY_SUBMITTED → remerciement neutre, zéro erreur visible.
 *  - 422 TICKET_NOT_CLOSED | FEEDBACK_WINDOW_EXPIRED → retour accueil silencieux.
 *  - Bouton 🎤 masqué si SpeechRecognition absent (Electron).
 *  - Retour accueil auto après 30 s d'inactivité (60 s mode accessibilité).
 *  - Tokens CSS uniquement, cibles ≥ 72 px, contraste ≥ 7:1.
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { A11Y_BASE_FONT_PX, accessibilityFontSizePx } from "@/lib/kiosk-voice";
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionInstance,
} from "@/lib/speech-recognition";

interface FeedbackScreenProps {
  /** trackingId nanoid(21) du ticket clos. */
  trackingId: string;
  /** Mode accessibilité → label agrandi + timeout doublé (60 s). */
  isAccessibilityMode?: boolean;
}

/** Longueur maximale d'un commentaire (contrat FeedbackRequest). */
const MAX_COMMENT_LENGTH = 500;
/** Fenêtre de feedback autorisée après clôture (contrat API-010 : 24 h). */
const FEEDBACK_WINDOW_MS = 24 * 3600_000;

type Phase = "loading" | "form" | "thankyou";

export function FeedbackScreen({
  trackingId,
  isAccessibilityMode = false,
}: FeedbackScreenProps) {
  const t = useTranslations("feedback009");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";

  const [phase, setPhase] = useState<Phase>("loading");
  const [note, setNote] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
  const goHome = () => router.push(`/${currentLocale}`);

  const timeoutMs = isAccessibilityMode ? 60_000 : 30_000;
  useInactivityTimeout(goHome, timeoutMs);

  const labelFontPx = isAccessibilityMode
    ? accessibilityFontSizePx()
    : A11Y_BASE_FONT_PX;

  // Détection de la Web Speech API (masque le bouton 🎤 dans Electron).
  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  // Éligibilité : GET /public/tickets/{trackingId} → DONE ET < 24 h.
  useEffect(() => {
    let cancelled = false;
    const checkEligibility = async () => {
      const client = createSigfaClient("public", apiUrl);
      try {
        const { data, response } = await client.GET(
          "/public/tickets/{trackingId}",
          { params: { path: { trackingId } } }
        );
        if (cancelled) return;
        const closedAt = data?.closedAt ? Date.parse(data.closedAt) : NaN;
        const withinWindow =
          !Number.isNaN(closedAt) && Date.now() - closedAt < FEEDBACK_WINDOW_MS;
        if (response.status === 200 && data?.status === "DONE" && withinWindow) {
          setPhase("form");
        } else {
          goHome();
        }
      } catch {
        if (!cancelled) goHome();
      }
    };
    void checkEligibility();
    return () => {
      cancelled = true;
    };
  }, [trackingId]);

  const handleComment = (value: string) => {
    setComment(value.slice(0, MAX_COMMENT_LENGTH));
  };

  const handleMic = () => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;
    const recognition: SpeechRecognitionInstance = new Ctor();
    recognition.lang =
      currentLocale === "en" ? "en-US" : "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      handleComment(transcript);
    };
    recognition.start();
  };

  const handleSubmit = async () => {
    if (note < 1) return;
    const client = createSigfaClient("public", apiUrl);
    try {
      const { response } = await client.POST(
        "/public/tickets/{trackingId}/feedback",
        {
          params: { path: { trackingId } },
          body: {
            note,
            comment: comment.length > 0 ? comment : undefined,
          },
        }
      );
      // 201 succès ET 409 déjà soumis → remerciement neutre (idempotence).
      if (response.status === 201 || response.status === 409) {
        setPhase("thankyou");
        return;
      }
      // 422 (non clôturé / fenêtre expirée) et autres → retour accueil silencieux.
      goHome();
    } catch {
      goHome();
    }
  };

  if (phase === "loading") {
    return (
      <main
        role="main"
        data-testid="feedback-loading"
        style={{
          backgroundColor: "var(--surface-kiosk)",
          minHeight: "100vh",
        }}
      />
    );
  }

  if (phase === "thankyou") {
    return (
      <main
        role="main"
        style={{
          backgroundColor: "var(--surface-kiosk)",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <p
          data-testid="feedback-thankyou"
          style={{
            fontSize: `${labelFontPx}px`,
            color: "var(--ink-inverse)",
            textAlign: "center",
          }}
        >
          {t("thankYou")}
        </p>
      </main>
    );
  }

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
        padding: "2rem",
      }}
    >
      <h1
        data-testid="feedback-title"
        style={{
          fontSize: "28px",
          fontWeight: "bold",
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {t("title")}
      </h1>

      {/* Note 1-5 : 5 étoiles tactiles ≥ 72 px, espacement ≥ 16 px */}
      <div
        data-testid="star-rating"
        role="radiogroup"
        style={{
          display: "flex",
          gap: "16px",
          justifyContent: "center",
        }}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            data-testid="feedback-star"
            role="radio"
            aria-checked={note === value}
            aria-label={t("starLabel", { n: value })}
            onClick={() => setNote(value)}
            style={{
              minWidth: "72px",
              minHeight: "72px",
              fontSize: `${labelFontPx}px`,
              color:
                value <= note ? "var(--warning)" : "var(--ink-muted-inv)",
              backgroundColor: "var(--surface-kiosk)",
              border: "2px solid var(--ink-inverse)",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">{value <= note ? "★" : "☆"}</span>
          </button>
        ))}
      </div>

      {/* Commentaire optionnel (texte éditable ≤ 500 caractères) */}
      <textarea
        data-testid="feedback-comment"
        value={comment}
        maxLength={MAX_COMMENT_LENGTH}
        placeholder={t("commentPlaceholder")}
        onChange={(e) => handleComment(e.target.value)}
        style={{
          width: "100%",
          maxWidth: "640px",
          minHeight: "96px",
          fontSize: "24px",
          color: "var(--ink-strong)",
          backgroundColor: "var(--surface-1)",
          border: "none",
          borderRadius: "0.5rem",
          padding: "1rem",
          resize: "none",
        }}
      />

      {/* Bouton 🎤 : masqué silencieusement si SpeechRecognition absent */}
      {speechSupported && (
        <button
          type="button"
          data-testid="feedback-mic"
          aria-label={t("micLabel")}
          onClick={handleMic}
          style={{
            minWidth: "72px",
            minHeight: "72px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            fontSize: `${labelFontPx}px`,
            color: "var(--ink-inverse)",
            backgroundColor: "var(--surface-kiosk)",
            border: "2px solid var(--ink-inverse)",
            borderRadius: "0.5rem",
            cursor: "pointer",
            padding: "0.5rem 1rem",
          }}
        >
          <span aria-hidden="true">🎤</span>
          <span>{t("micLabel")}</span>
        </button>
      )}

      <button
        type="button"
        data-testid="feedback-submit"
        onClick={() => {
          void handleSubmit();
        }}
        disabled={note < 1}
        style={{
          minHeight: "88px",
          width: "100%",
          maxWidth: "640px",
          backgroundColor: "var(--brand)",
          color: "var(--ink-inverse)",
          fontSize: "28px",
          fontWeight: "bold",
          border: "none",
          borderRadius: "0.75rem",
          cursor: note < 1 ? "not-allowed" : "pointer",
          opacity: note < 1 ? 0.5 : 1,
        }}
      >
        {t("submitButton")}
      </button>
    </main>
  );
}
