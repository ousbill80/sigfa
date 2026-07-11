#!/usr/bin/env bash
# contract-diff.sh — CONTRACT-009c
# Compare chaque fichier openapi/*.yaml modifié vs origin/main via oasdiff (Docker).
#
# Usage :
#   ./scripts/contract-diff.sh [fichier1.yaml] [fichier2.yaml] ...
#   Sans argument : détecte automatiquement les fichiers openapi/*.yaml modifiés vs origin/main
#
# Comportement :
#   - Fichier NOUVEAU (pas de base sur origin/main) → additif par définition → exit 0
#   - Changement additif seulement → exit 0
#   - Breaking change → exit 1 listant les breakings
#   - Branche = main → skip (pas de diff intra-main)
#
# Prérequis : Docker (image tufin/oasdiff tirée à la demande)

set -euo pipefail

# ─── Contournement macOS docker-credential-desktop ───────────────────────────
# Sur macOS, docker-credential-desktop peut être un lien brisé.
# On utilise un DOCKER_CONFIG sans credStore si non défini.
if [[ -z "${DOCKER_CONFIG:-}" ]]; then
  SIGFA_DOCKER_CONFIG="/tmp/sigfa-docker-nocreds-$$"
  mkdir -p "${SIGFA_DOCKER_CONFIG}"
  echo '{"auths":{}}' > "${SIGFA_DOCKER_CONFIG}/config.json"
  export DOCKER_CONFIG="${SIGFA_DOCKER_CONFIG}"
  # Nettoyage à la sortie
  trap 'rm -rf "${SIGFA_DOCKER_CONFIG}"' EXIT
fi

# ─── Vérification de Docker ───────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker introuvable. Docker est requis pour oasdiff." >&2
  exit 1
fi

# ─── Détection branche = main → skip ────────────────────────────────────────
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
if [[ "${CURRENT_BRANCH}" == "main" ]]; then
  echo "[contract-diff] Branche = main — aucun diff à comparer (skip)."
  exit 0
fi

# ─── Déterminer les fichiers à comparer ──────────────────────────────────────
declare -a YAML_FILES=()

if [[ $# -gt 0 ]]; then
  # Fichiers passés en argument
  YAML_FILES=("$@")
else
  # Auto-détection : fichiers openapi/*.yaml modifiés vs origin/main
  if ! git rev-parse origin/main &>/dev/null 2>&1; then
    echo "[contract-diff] origin/main introuvable — aucun diff possible." >&2
    echo "[contract-diff] Assurez-vous que le remote origin est configuré et fetch effectué." >&2
    exit 0
  fi

  while IFS= read -r file; do
    [[ -n "${file}" ]] && YAML_FILES+=("${file}")
  done < <(git diff --name-only origin/main HEAD -- 'openapi/*.yaml' 2>/dev/null || true)

  if [[ ${#YAML_FILES[@]} -eq 0 ]]; then
    echo "[contract-diff] Aucun fichier openapi/*.yaml modifié vs origin/main."
    exit 0
  fi
fi

echo "[contract-diff] Fichiers à comparer : ${YAML_FILES[*]}"

# ─── Lancer oasdiff pour chaque fichier ──────────────────────────────────────
BREAKING_FOUND=0
BREAKING_DETAILS=""

for yaml_file in "${YAML_FILES[@]}"; do
  # Normaliser le chemin relatif au repo
  if [[ "${yaml_file}" = /* ]]; then
    # Chemin absolu → rendre relatif depuis le répertoire courant
    file_rel="${yaml_file}"
  else
    file_rel="${yaml_file}"
  fi

  echo ""
  echo "── Comparaison : ${file_rel} ──"

  # Vérifier si le fichier existe sur origin/main (sinon → nouveau → additif)
  if ! git show "origin/main:${file_rel}" &>/dev/null 2>&1; then
    echo "  → Fichier NOUVEAU (absent de origin/main) : additif par définition ✓"
    continue
  fi

  # Extraire la version base depuis origin/main dans un fichier temporaire
  BASE_TMP="$(mktemp /tmp/oasdiff-base-XXXXXX.yaml)"
  HEAD_TMP="$(mktemp /tmp/oasdiff-head-XXXXXX.yaml)"

  # Nettoyage local de ces temporaires (en plus du trap global)
  # shellcheck disable=SC2064
  trap "rm -f '${BASE_TMP}' '${HEAD_TMP}'" RETURN 2>/dev/null || true

  git show "origin/main:${file_rel}" > "${BASE_TMP}"

  # Version courante : depuis le fichier de travail si présent, sinon depuis HEAD
  if [[ -f "${file_rel}" ]]; then
    cp "${file_rel}" "${HEAD_TMP}"
  else
    git show "HEAD:${file_rel}" > "${HEAD_TMP}" 2>/dev/null || {
      echo "  → Fichier supprimé dans HEAD — traité comme breaking (endpoint removal)" >&2
      BREAKING_FOUND=1
      BREAKING_DETAILS+=$'\n'"  BREAKING: ${file_rel} supprimé dans HEAD"
      rm -f "${BASE_TMP}" "${HEAD_TMP}"
      continue
    }
  fi

  # Exécuter oasdiff breaking avec --fail-on ERR pour exit 1 si breaking changes
  echo "  → oasdiff breaking : ${file_rel}"
  OASDIFF_OUTPUT=""
  OASDIFF_EXIT=0

  set +e
  OASDIFF_OUTPUT="$(docker run --rm \
    -v "${BASE_TMP}:/base.yaml:ro" \
    -v "${HEAD_TMP}:/head.yaml:ro" \
    tufin/oasdiff breaking /base.yaml /head.yaml --fail-on ERR 2>&1)"
  OASDIFF_EXIT=$?
  set -e

  rm -f "${BASE_TMP}" "${HEAD_TMP}"

  if [[ ${OASDIFF_EXIT} -ne 0 ]]; then
    echo "  ✘ Breaking changes détectés dans ${file_rel} :"
    echo "${OASDIFF_OUTPUT}" | sed 's/^/    /'
    BREAKING_FOUND=1
    BREAKING_DETAILS+=$'\n'"=== ${file_rel} ===\n${OASDIFF_OUTPUT}"
  else
    echo "  ✔ Aucun breaking change (additif ou identique) : ${file_rel}"
    if [[ -n "${OASDIFF_OUTPUT}" ]]; then
      echo "${OASDIFF_OUTPUT}" | sed 's/^/    /'
    fi
  fi
done

# ─── Résumé ──────────────────────────────────────────────────────────────────
echo ""
if [[ ${BREAKING_FOUND} -ne 0 ]]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  CONTRACT-DIFF : BREAKING CHANGES DÉTECTÉS                  ║"
  echo "║  La PR introduit des breaking changes sans montée en /v2.   ║"
  echo "║  Corrigez les breaking changes ou ouvrez une story /v2.     ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Détails :"
  echo -e "${BREAKING_DETAILS}"
  exit 1
else
  echo "✔ CONTRACT-DIFF : Aucun breaking change — uniquement additif ou sans changement."
  exit 0
fi
