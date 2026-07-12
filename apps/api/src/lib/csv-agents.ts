/**
 * Parsing + validation du CSV d'import d'agents — API-009 (agents.yaml).
 *
 * LA LOI du fichier :
 *   - Encodage UTF-8 sans BOM, séparateur virgule.
 *   - Colonnes obligatoires : `email`, `firstName`, `lastName`, `role`.
 *   - Colonnes optionnelles : `agencyCode`, `languages`, `phone`.
 *   - **≤ 500 lignes** (hors en-tête) — au-delà : 422 `IMPORT_TOO_LARGE`.
 *
 * Ce module ne fait AUCUN accès base : il transforme un texte CSV en lignes
 * structurées + erreurs de FORMAT par ligne (email vide, rôle invalide,
 * téléphone non E.164). La création (transaction par ligne, doublons) est du
 * ressort du routeur. Champs entre guillemets supportés (ex. `"FR,DIOULA"`).
 *
 * @module
 */

import { SigfaError } from "src/lib/errors.js";

/** Nombre maximal de lignes de données (hors en-tête). */
export const MAX_IMPORT_LINES = 500;

/** Colonnes obligatoires du CSV (ordre non imposé). */
const REQUIRED_COLUMNS = ["email", "firstName", "lastName", "role"] as const;

/** Rôles valides pour un agent importé (LA LOI `Role`, hors sentinelles). */
const VALID_ROLES = new Set([
  "SUPER_ADMIN",
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
]);

/** Langues valides (LA LOI `AgentLanguage`). */
const VALID_LANGUAGES = new Set(["FR", "DIOULA", "BAOULE", "EN"]);

/** Regex E.164 : `+`, chiffre 1–9, puis 6 à 14 chiffres. */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Regex e-mail simple (validation de format, pas de RFC exhaustive). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Erreur de traitement d'une ligne (LA LOI `ImportError`). */
export interface ImportError {
  /** Numéro de ligne CSV (en-tête = 1, données à partir de 2). */
  line: number;
  /** Colonne fautive. */
  field: string;
  /** Code UPPER_SNAKE_CASE. */
  code: string;
  /** Message humain. */
  message: string;
}

/** Ligne d'agent valide extraite du CSV. */
export interface ParsedAgentRow {
  /** Numéro de ligne CSV (≥ 2). */
  line: number;
  /** Adresse e-mail. */
  email: string;
  /** Prénom. */
  firstName: string;
  /** Nom. */
  lastName: string;
  /** Rôle RBAC. */
  role: string;
  /** Code d'agence (optionnel). */
  agencyCode: string | null;
  /** Langues (défaut ['FR']). */
  languages: string[];
  /** Téléphone E.164 (optionnel). */
  phone: string | null;
}

/** Résultat du parsing : lignes valides + erreurs de format. */
export interface ParseResult {
  /** Lignes valides prêtes à insérer. */
  rows: ParsedAgentRow[];
  /** Erreurs de format détectées ligne par ligne. */
  errors: ImportError[];
}

/**
 * Découpe une ligne CSV en champs, en respectant les champs entre guillemets.
 *
 * @param line - Ligne CSV brute (sans saut de ligne final)
 * @returns Champs (guillemets externes retirés)
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Valide l'en-tête : colonnes obligatoires présentes, sinon 422 INVALID_CSV_FORMAT.
 *
 * @param header - Champs de la première ligne
 * @throws {SigfaError} 422 INVALID_CSV_FORMAT si une colonne requise manque
 */
function assertHeader(header: string[]): void {
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      throw new SigfaError(
        "INVALID_CSV_FORMAT",
        `Colonne obligatoire manquante : ${col}.`,
        422
      );
    }
  }
}

/** Découpe le texte en lignes non vides (gère \r\n et BOM absent). */
function toLines(csv: string): string[] {
  return csv
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

/**
 * Parse et valide le CSV d'import d'agents.
 *
 * @param csv - Contenu texte UTF-8 du fichier
 * @returns Lignes valides + erreurs de format
 * @throws {SigfaError} 422 IMPORT_TOO_LARGE (> 500 lignes) ou INVALID_CSV_FORMAT
 */
export function parseAgentCsv(csv: string): ParseResult {
  const lines = toLines(csv);
  if (lines.length === 0) {
    throw new SigfaError("INVALID_CSV_FORMAT", "Fichier CSV vide.", 422);
  }
  const header = splitCsvLine(lines[0] as string);
  assertHeader(header);
  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_LINES) {
    throw new SigfaError(
      "IMPORT_TOO_LARGE",
      "Le fichier CSV dépasse la limite de 500 lignes.",
      422,
      { maxLines: MAX_IMPORT_LINES, receivedLines: dataLines.length }
    );
  }
  return validateRows(header, dataLines);
}

/** Valide chaque ligne de données et sépare lignes valides / erreurs. */
function validateRows(header: string[], dataLines: string[]): ParseResult {
  const rows: ParsedAgentRow[] = [];
  const errors: ImportError[] = [];
  dataLines.forEach((raw, index) => {
    const lineNo = index + 2;
    const record = toRecord(header, splitCsvLine(raw));
    const rowErrors = validateRecord(lineNo, record);
    if (rowErrors.length > 0) errors.push(...rowErrors);
    else rows.push(buildRow(lineNo, record));
  });
  return { rows, errors };
}

/** Associe les valeurs aux noms de colonnes de l'en-tête. */
function toRecord(header: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((col, i) => {
    record[col] = values[i] ?? "";
  });
  return record;
}

/** Valide un enregistrement : retourne les erreurs de format (ordre stable). */
function validateRecord(
  line: number,
  record: Record<string, string>
): ImportError[] {
  const errors: ImportError[] = [];
  if (!EMAIL_REGEX.test(record["email"] ?? "")) {
    errors.push(err(line, "email", "INVALID_EMAIL", "Adresse e-mail invalide."));
  }
  if (!(record["firstName"] ?? "").trim()) {
    errors.push(err(line, "firstName", "MISSING_FIELD", "Le prénom est obligatoire."));
  }
  if (!(record["lastName"] ?? "").trim()) {
    errors.push(err(line, "lastName", "MISSING_FIELD", "Le nom est obligatoire."));
  }
  if (!VALID_ROLES.has(record["role"] ?? "")) {
    errors.push(
      err(line, "role", "INVALID_ROLE", `La valeur '${record["role"] ?? ""}' n'est pas un rôle valide.`)
    );
  }
  const phone = (record["phone"] ?? "").trim();
  if (phone && !E164_REGEX.test(phone)) {
    errors.push(
      err(line, "phone", "INVALID_PHONE_FORMAT", `Le téléphone '${phone}' n'est pas au format E.164.`)
    );
  }
  return errors;
}

/** Construit une ligne valide (langues par défaut ['FR']). */
function buildRow(
  line: number,
  record: Record<string, string>
): ParsedAgentRow {
  return {
    line,
    email: (record["email"] ?? "").toLowerCase(),
    firstName: record["firstName"] ?? "",
    lastName: record["lastName"] ?? "",
    role: record["role"] ?? "",
    agencyCode: (record["agencyCode"] ?? "").trim() || null,
    languages: parseLanguages(record["languages"] ?? ""),
    phone: (record["phone"] ?? "").trim() || null,
  };
}

/** Extrait les langues valides d'un champ `"FR,DIOULA"`, défaut ['FR']. */
function parseLanguages(raw: string): string[] {
  const parsed = raw
    .split(",")
    .map((l) => l.trim().toUpperCase())
    .filter((l) => VALID_LANGUAGES.has(l));
  return parsed.length > 0 ? parsed : ["FR"];
}

/** Fabrique une `ImportError`. */
function err(
  line: number,
  field: string,
  code: string,
  message: string
): ImportError {
  return { line, field, code, message };
}
