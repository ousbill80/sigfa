/**
 * sms-templates-render — rendu des templates SMS par banque + langue (NOTIF-002).
 *
 * LA LOI (NOTIF-002) :
 *  - Résolution du template avec fallback : `(bank, lang)` → `(bank, FR)` →
 *    `(FR global seedé)`. JAMAIS de corps vide.
 *  - Rendu strict des variables `{{number}} {{position}} {{estimate}}` : une variable
 *    référencée mais non fournie ⇒ `TemplateRenderError` (→ DLQ `TEMPLATE_RENDER_ERROR`,
 *    jamais un texte cassé avec `{{position}}` littéral).
 *  - Langues FR/EN uniquement (décision PO ; Dioula/Baoulé retirés).
 *
 * @module
 */

/** Langues supportées pour le rendu SMS (FR/EN uniquement — décision PO). */
export type SmsLang = "FR" | "EN";

/** Variables autorisées dans un template SMS (LA LOI). */
export const TEMPLATE_VARIABLES = ["number", "position", "estimate"] as const;

/** Nom d'une variable de template autorisée. */
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Contexte de rendu : valeurs des variables (toutes optionnelles à l'entrée). */
export type RenderContext = Partial<Record<TemplateVariable, string | number>>;

/** Un template résolu (corps + langue effectivement retenue). */
export interface ResolvedTemplate {
  /** Corps brut du template (avec `{{...}}`). */
  body: string;
  /** Langue effectivement retenue après fallback. */
  lang: SmsLang | "FR_GLOBAL";
}

/** Clé de lookup d'un template. */
export interface TemplateKey {
  /** Banque propriétaire. */
  bankId: string;
  /** Type de notification (LA LOI `NotificationType`). */
  type: string;
  /** Langue demandée. */
  lang: SmsLang;
}

/**
 * Source de templates : renvoie le corps d'un template `(bank, type, SMS, lang)`
 * ou `undefined` si absent. `globalFallback` fournit le FR global seedé.
 */
export interface TemplateSource {
  /**
   * Charge le corps d'un template banque pour une langue donnée.
   *
   * @param bankId - Banque
   * @param type   - Type de notification
   * @param lang   - Langue (FR/EN)
   * @returns Corps ou `undefined` si absent
   */
  loadBankTemplate: (
    bankId: string,
    type: string,
    lang: SmsLang
  ) => Promise<string | undefined>;
  /**
   * Charge le corps du template FR GLOBAL seedé (dernier recours).
   *
   * @param type - Type de notification
   * @returns Corps FR global ou `undefined` si non seedé
   */
  loadGlobalFallback: (type: string) => Promise<string | undefined>;
}

/** Erreur de rendu : template introuvable partout, ou variable manquante. */
export class TemplateRenderError extends Error {
  /** Nom logique de la faute (pour le failure_reason énuméré). */
  readonly reason: "TEMPLATE_RENDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
    this.reason = "TEMPLATE_RENDER_ERROR";
  }
}

/**
 * Résout un template avec fallback banque→FR banque→FR global. JAMAIS de corps vide.
 *
 * @param source - Source de templates
 * @param key    - Clé `(bank, type, lang)`
 * @returns Template résolu (corps non vide + langue retenue)
 * @throws {TemplateRenderError} Si aucun template n'est trouvé (évite tout corps vide)
 */
export async function resolveTemplate(
  source: TemplateSource,
  key: TemplateKey
): Promise<ResolvedTemplate> {
  // 1. Template banque dans la langue demandée.
  const exact = await source.loadBankTemplate(key.bankId, key.type, key.lang);
  if (exact !== undefined && exact.trim() !== "") {
    return { body: exact, lang: key.lang };
  }
  // 2. Repli sur le FR de la banque (si la langue demandée n'était pas déjà FR).
  if (key.lang !== "FR") {
    const bankFr = await source.loadBankTemplate(key.bankId, key.type, "FR");
    if (bankFr !== undefined && bankFr.trim() !== "") {
      return { body: bankFr, lang: "FR" };
    }
  }
  // 3. Dernier recours : FR global seedé.
  const global = await source.loadGlobalFallback(key.type);
  if (global !== undefined && global.trim() !== "") {
    return { body: global, lang: "FR_GLOBAL" };
  }
  throw new TemplateRenderError(
    `Aucun template pour (bank=${key.bankId}, type=${key.type}) — fallback FR global absent.`
  );
}

/** Extrait tous les noms de variables `{{name}}` d'un corps. */
function referencedVariables(body: string): string[] {
  const names: string[] = [];
  const re = /\{\{\s*([^}\s]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    names.push(m[1] as string);
  }
  return names;
}

/**
 * Rend un corps de template en substituant les variables. Toute variable référencée
 * mais absente du contexte (ou inconnue) ⇒ `TemplateRenderError` : jamais de texte
 * cassé (`{{position}}` littéral) envoyé au fournisseur.
 *
 * @param body    - Corps brut du template (avec `{{...}}`)
 * @param context - Valeurs des variables fournies
 * @returns Corps rendu (sans `{{...}}`)
 * @throws {TemplateRenderError} Si une variable référencée est manquante ou inconnue
 */
export function renderTemplateBody(body: string, context: RenderContext): string {
  for (const name of referencedVariables(body)) {
    const known = (TEMPLATE_VARIABLES as readonly string[]).includes(name);
    const provided =
      known && context[name as TemplateVariable] !== undefined;
    if (!known) {
      throw new TemplateRenderError(`Variable inconnue '{{${name}}}'.`);
    }
    if (!provided) {
      throw new TemplateRenderError(`Variable manquante '{{${name}}}'.`);
    }
  }
  return body.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_match, name: string) => {
    const value = context[name as TemplateVariable];
    // Garanti défini par la validation ci-dessus.
    return String(value);
  });
}

/**
 * Résout puis rend un template SMS de bout en bout (fallback + substitution stricte).
 *
 * @param source  - Source de templates
 * @param key     - Clé `(bank, type, lang)`
 * @param context - Valeurs des variables
 * @returns Corps final prêt à envoyer + langue retenue
 * @throws {TemplateRenderError} Si template absent ou variable manquante
 */
export async function renderSmsTemplate(
  source: TemplateSource,
  key: TemplateKey,
  context: RenderContext
): Promise<{ body: string; lang: ResolvedTemplate["lang"] }> {
  const resolved = await resolveTemplate(source, key);
  return { body: renderTemplateBody(resolved.body, context), lang: resolved.lang };
}
