/**
 * KIOSK-009 — speech-recognition.ts
 * Types minimaux et détection de la Web Speech API (SpeechRecognition).
 *
 * `SpeechRecognition` n'est pas dans lib.dom standard : on déclare ici les
 * types strictement nécessaires (aucun `any`) et un accès sûr au constructeur,
 * préfixé WebKit inclus. Absent dans Electron → détection retourne `null`.
 */

/** Un résultat de reconnaissance (indexable par index sur les alternatives). */
export interface SpeechRecognitionAlternative {
  transcript: string;
}

export interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResultEvent {
  readonly results: SpeechRecognitionResultList;
}

/** Instance minimale du moteur de reconnaissance vocale. */
export interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/**
 * Retourne le constructeur SpeechRecognition disponible (standard ou préfixé
 * WebKit), ou `null` si l'environnement ne le supporte pas (ex. Electron).
 */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
