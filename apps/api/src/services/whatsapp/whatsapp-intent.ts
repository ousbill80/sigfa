/**
 * whatsapp-intent — reconnaissance d'intention ENTRANTE par RÈGLES (NOTIF-003).
 *
 * LA LOI (NOTIF-003) : la NLU d'intention est volontairement **règles / mots-clés /
 * menu** — PAS d'IA (l'IA d'intention est F10, hors couche). Trois intentions :
 *  - `TAKE_TICKET` : « prendre un ticket » (+ service résolu par le mapping menu C4).
 *  - `CHECK_STATUS` : « état / position de mon ticket ».
 *  - `HELP` : ambiguë / non reconnue ⇒ message d'aide (menu FR/EN), zéro ticket.
 *
 * Le mapping menu→service vient de la config WhatsApp de la banque (CONTRACT-013,
 * bloc C4 : `menuMapping[] = { keyword, serviceId }`). Un mot-clé du mapping qui
 * matche ⇒ `TAKE_TICKET` vers ce `serviceId`. Sinon, on classe par mots-clés
 * généraux FR/EN. Rien ne matche ⇒ `HELP`.
 *
 * @module
 */

import type { SmsLang } from "src/services/sms-templates-render.js";

/** Entrée de mapping menu/mot-clé → service (LA LOI `WhatsAppMenuMapping`, C4). */
export interface WhatsAppMenuMapping {
  /** Mot-clé ou entrée de menu (ex. "1", "DEPOT"). Comparé insensible à la casse. */
  keyword: string;
  /** Service SIGFA ciblé (UUID). */
  serviceId: string;
}

/** Intention reconnue à partir d'un message entrant. */
export type WhatsAppIntent =
  | { kind: "TAKE_TICKET"; serviceId: string }
  | { kind: "CHECK_STATUS" }
  | { kind: "HELP" };

/** Mots-clés généraux « prendre un ticket » (FR/EN), hors mapping menu banque. */
const TAKE_TICKET_KEYWORDS = [
  "ticket",
  "prendre",
  "rendez",
  "queue",
  "file",
  "take",
  "join",
] as const;

/** Mots-clés « état / position » (FR/EN). */
const STATUS_KEYWORDS = [
  "etat",
  "état",
  "position",
  "statut",
  "status",
  "attente",
  "wait",
  "where",
] as const;

/**
 * Normalise un texte entrant pour la comparaison : minuscule + trim + espaces
 * compactés. Aucune dépendance à une langue (règles pures).
 *
 * @param raw - Texte brut du message entrant
 * @returns Texte normalisé
 */
export function normalizeInbound(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Classe un message entrant en intention par RÈGLES (pas d'IA).
 *
 * Ordre de résolution :
 *  1. Mapping menu banque (C4) : si le texte normalisé ÉGALE un `keyword` (menu
 *     numéroté ex. "1") OU le CONTIENT comme mot ⇒ `TAKE_TICKET` vers son service.
 *  2. Mots-clés « état » ⇒ `CHECK_STATUS`.
 *  3. Mots-clés généraux « prendre un ticket » ⇒ `HELP` si le service est ambigu
 *     (aucun mapping ne permet de choisir) — on NE crée jamais de ticket sans
 *     service résolu ; on renvoie l'aide (menu) pour désambiguïser.
 *  4. Sinon ⇒ `HELP`.
 *
 * @param raw     - Texte brut du message entrant
 * @param mapping - Mapping menu→service de la banque (C4)
 * @returns Intention reconnue (jamais de ticket sans service résolu)
 */
export function classifyIntent(
  raw: string,
  mapping: WhatsAppMenuMapping[]
): WhatsAppIntent {
  const text = normalizeInbound(raw);
  if (text === "") return { kind: "HELP" };

  // 1. Mapping menu banque : match exact du keyword (ex. "1") ou en tant que mot.
  const words = new Set(text.split(" "));
  for (const entry of mapping) {
    const kw = normalizeInbound(entry.keyword);
    if (kw !== "" && (text === kw || words.has(kw))) {
      return { kind: "TAKE_TICKET", serviceId: entry.serviceId };
    }
  }

  // 2. Intention « état / position ».
  if (STATUS_KEYWORDS.some((k) => words.has(k) || text.includes(k))) {
    return { kind: "CHECK_STATUS" };
  }

  // 3. « prendre un ticket » sans service résolvable ⇒ aide (menu) pour choisir.
  //    (Un service précis n'est jamais deviné : anti-ambiguïté LA LOI.)
  if (TAKE_TICKET_KEYWORDS.some((k) => words.has(k) || text.includes(k))) {
    return { kind: "HELP" };
  }

  // 4. Non reconnue ⇒ aide.
  return { kind: "HELP" };
}

/**
 * Construit le message d'aide (menu) FR/EN listant les entrées de service et le
 * mot-clé « état ». Aucun ticket n'est créé.
 *
 * @param lang    - Langue du destinataire (FR/EN)
 * @param mapping - Mapping menu→service (les `keyword` sont listés)
 * @returns Corps du message d'aide
 */
export function buildHelpMessage(
  lang: SmsLang,
  mapping: WhatsAppMenuMapping[]
): string {
  const keywords = mapping.map((m) => m.keyword).join(", ");
  if (lang === "EN") {
    const menu =
      keywords === ""
        ? "Sorry, no service is available for now."
        : `To take a ticket, reply with: ${keywords}.`;
    return `${menu} Reply "status" to check your ticket position.`;
  }
  const menu =
    keywords === ""
      ? "Désolé, aucun service n'est disponible pour le moment."
      : `Pour prendre un ticket, répondez : ${keywords}.`;
  return `${menu} Répondez « état » pour connaître votre position.`;
}
