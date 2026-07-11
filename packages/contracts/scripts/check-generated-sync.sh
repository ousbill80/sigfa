#!/usr/bin/env bash
# check-generated-sync.sh — CONTRACT-009c
# Vérifie que les fichiers generated/ sont synchronisés avec les sources OpenAPI.
#
# Procédure :
#   1. Relancer bundle + generate (déterministe) via node directement
#   2. git diff --exit-code -- generated/
#   3. Si différence → exit 1 avec message actionnable
#   4. Si aucune différence → exit 0
#
# Usage :
#   ./scripts/check-generated-sync.sh
#
# Variables d'env supportées :
#   CONTRACTS_DIR — répertoire racine de @sigfa/contracts (défaut : parent du script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

echo "[check-generated-sync] Répertoire contracts : ${CONTRACTS_DIR}"

# ─── Prérequis ────────────────────────────────────────────────────────────────
if [[ ! -d "${CONTRACTS_DIR}/openapi" ]]; then
  echo "ERROR: Répertoire openapi/ introuvable dans ${CONTRACTS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${CONTRACTS_DIR}/scripts/bundle.mjs" ]]; then
  echo "ERROR: scripts/bundle.mjs introuvable dans ${CONTRACTS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${CONTRACTS_DIR}/scripts/generate.mjs" ]]; then
  echo "ERROR: scripts/generate.mjs introuvable dans ${CONTRACTS_DIR}" >&2
  exit 1
fi

# ─── Trouver Node.js ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: node introuvable dans PATH." >&2
  exit 1
fi

# ─── Relancer bundle + generate ──────────────────────────────────────────────
echo "[check-generated-sync] Relance bundle…"
if ! node "${CONTRACTS_DIR}/scripts/bundle.mjs" 2>&1; then
  echo "ERROR: La commande 'bundle' a échoué — impossible de vérifier la synchronisation." >&2
  exit 1
fi

echo "[check-generated-sync] Relance generate…"
if ! node "${CONTRACTS_DIR}/scripts/generate.mjs" 2>&1; then
  echo "ERROR: La commande 'generate' a échoué — impossible de vérifier la synchronisation." >&2
  exit 1
fi

echo "[check-generated-sync] generate terminé — vérification du diff git…"

# ─── Vérifier le diff git sur generated/ ──────────────────────────────────────
cd "${CONTRACTS_DIR}"

# git diff --exit-code retourne 1 si des modifications sont présentes
# Compare le working tree vs l'index (ce qui est commité/staged)
DIFF_OUTPUT=""
DIFF_EXIT=0

set +e
DIFF_OUTPUT="$(git diff --exit-code -- generated/ 2>&1)"
DIFF_EXIT=$?
set -e

if [[ ${DIFF_EXIT} -ne 0 ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  GENERATED DÉSYNCHRONISÉ — relancez generate                    ║"
  echo "║  Les fichiers generated/ ne correspondent pas aux sources.      ║"
  echo "║                                                                  ║"
  echo "║  → Relancez generate et committez les fichiers generated/       ║"
  echo "║    pnpm --filter @sigfa/contracts run generate                  ║"
  echo "║    git add packages/contracts/generated/                        ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Fichiers désynchronisés :"
  git diff --name-only -- generated/ 2>/dev/null | sed 's/^/  - /'
  echo ""
  echo "Diff (100 premières lignes) :"
  echo "${DIFF_OUTPUT}" | head -100
  exit 1
fi

echo ""
echo "✔ [check-generated-sync] generated/ est synchronisé avec les sources."
exit 0
