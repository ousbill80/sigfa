#!/usr/bin/env sh
# INFRA-004: require-test-in-commit — Règle T1
# Tout fichier source *.ts/tsx sous apps/ ou packages/ doit avoir
# un fichier de test touché dans le même commit.
#
# Usage : exécuté par lefthook en pre-commit.
# POSIX-robuste : toutes les variables sont entre guillemets.

set -eu

# ─── Détecter le répertoire racine du dépôt (portable, POSIX) ────────────────
REPO_ROOT="$(git rev-parse --show-toplevel)"

# ─── Fichiers exemptés (globs dans lefthook/test-exemptions.txt) ─────────────
EXEMPTIONS_FILE="${REPO_ROOT}/lefthook/test-exemptions.txt"

# ─── Vérification barrel (index.ts pur = uniquement re-exports) ──────────────
# Retourne 0 si le fichier est un barrel pur, 1 sinon
is_pure_barrel() {
  _file="$1"
  # Si le fichier n'est pas un index.ts/tsx, ce n'est pas un barrel
  _basename="$(basename "${_file}")"
  if [ "${_basename}" != "index.ts" ] && [ "${_basename}" != "index.tsx" ]; then
    return 1
  fi
  # Vérifier que chaque ligne non vide / non commentaire est un re-export
  _content="$(git show ":${_file}" 2>/dev/null || true)"
  if [ -z "${_content}" ]; then
    return 1
  fi
  # Parcourir chaque ligne
  _has_non_export=0
  while IFS= read -r _line || [ -n "${_line}" ]; do
    # Supprimer les espaces en début de ligne
    _trimmed="$(printf '%s' "${_line}" | sed 's/^[[:space:]]*//')"
    # Ignorer les lignes vides
    [ -z "${_trimmed}" ] && continue
    # Ignorer les commentaires // et /* et #
    case "${_trimmed}" in
      //*) continue ;;
      "/*"*) continue ;;
      "#"*) continue ;;
    esac
    # Tester si la ligne est un re-export (export * from ou export { } from)
    # On utilise grep pour éviter les problèmes de caractères spéciaux dans case
    if printf '%s' "${_trimmed}" | grep -qE "^export (\* |type \* |\{ ?|type \{ ?)[^;]*from "; then
      continue
    fi
    # Toute autre ligne = logique = pas un barrel pur
    _has_non_export=1
    break
  done << BARREL_EOF
${_content}
BARREL_EOF
  return "${_has_non_export}"
}

# ─── Vérifier si un fichier est exempté par les globs ────────────────────────
is_exempted_by_glob() {
  _f="$1"
  # Exemptions codées en dur (toujours actives)
  # 1. Fichiers de test eux-mêmes
  case "${_f}" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) return 0 ;;
  esac
  # 2. Fichiers de déclaration
  case "${_f}" in
    *.d.ts) return 0 ;;
  esac
  # 3. Fichiers de config
  case "${_f}" in
    *.config.ts|*.config.tsx|*.config.js|*.config.mjs) return 0 ;;
  esac
  # 4. Migrations
  case "${_f}" in
    packages/database/migrations/*) return 0 ;;
  esac
  # 5. Générés
  case "${_f}" in
    packages/contracts/generated/*) return 0 ;;
  esac
  # Exemptions supplémentaires depuis le fichier (globs commentés)
  if [ -f "${EXEMPTIONS_FILE}" ]; then
    while IFS= read -r _glob || [ -n "${_glob}" ]; do
      # Ignorer les lignes vides et les commentaires
      case "${_glob}" in
        ''|'#'*) continue ;;
      esac
      # Correspondance shell glob simple via case
      # shellcheck disable=SC2254
      case "${_f}" in
        ${_glob}) return 0 ;;
      esac
    done < "${EXEMPTIONS_FILE}"
  fi
  return 1
}

# ─── Extraire le workspace pnpm d'un fichier ─────────────────────────────────
get_workspace() {
  _f="$1"
  # Extraire les deux premiers composants du chemin : apps/<name> ou packages/<name>
  # ex: apps/api/src/foo.ts → apps/api
  printf '%s' "${_f}" | cut -d'/' -f1-2
}

# ─── Collecter les fichiers stagés ────────────────────────────────────────────
# On utilise --name-status -M pour détecter les renommages
STAGED_STATUS="$(git diff --cached --name-status -M)"

# ─── Fichiers tests stagés (pour repli workspace) ────────────────────────────
STAGED_TESTS="$(git diff --cached --name-only | grep -E '\.(test|spec)\.(ts|tsx)$' || true)"

# ─── Identifier les fichiers source à vérifier ───────────────────────────────
MISSING=0
MISSING_LIST=""

# Parcourir chaque ligne du statut
while IFS='	' read -r _status _old _new || [ -n "${_status}" ]; do
  # Ignorer les lignes vides
  [ -z "${_status}" ] && continue

  # Déterminer le nom du fichier selon le type de statut
  case "${_status}" in
    R100)
      # Renommage pur (100% similaire) → toujours accepté
      continue
      ;;
    R*)
      # Renommage partiel (similitude < 100%) → traité comme modification
      # _new contient le nouveau nom (quand il y a deux colonnes)
      _file="${_new:-${_old}}"
      ;;
    A|M|C*)
      # Ajout, modification, copie
      _file="${_old}"
      ;;
    D*)
      # Suppression → ignorée
      continue
      ;;
    *)
      # Autre statut inconnu → ignorer
      continue
      ;;
  esac

  # Vérifier que c'est un fichier TypeScript sous apps/ ou packages/
  case "${_file}" in
    apps/*.ts|apps/*.tsx|packages/*.ts|packages/*.tsx) ;;
    *) continue ;;
  esac

  # Exempter les fichiers de test eux-mêmes
  case "${_file}" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) continue ;;
  esac

  # Vérifier les exemptions par glob
  if is_exempted_by_glob "${_file}"; then
    continue
  fi

  # Vérifier si c'est un barrel pur
  if is_pure_barrel "${_file}"; then
    continue
  fi

  # ─── Chercher un test correspondant (règle principale) ─────────────────────
  _base="$(basename "${_file}" | sed -E 's/\.(ts|tsx)$//')"
  _dir="$(dirname "${_file}")"

  # Recherche dans le diff stagé : <base>.test.ts(x) ou <base>.spec.ts(x)
  # dans le même dossier ou dans __tests__/
  _found=0
  for _test in ${STAGED_TESTS}; do
    _tbase="$(basename "${_test}" | sed -E 's/\.(test|spec)\.(ts|tsx)$//')"
    _tdir="$(dirname "${_test}")"

    if [ "${_tbase}" = "${_base}" ]; then
      # Même nom de base — vérifier le dossier
      if [ "${_tdir}" = "${_dir}" ] || [ "${_tdir}" = "${_dir}/__tests__" ]; then
        _found=1
        break
      fi
    fi
  done

  # ─── Règle de repli : tout test du même workspace pnpm ───────────────────
  if [ "${_found}" -eq 0 ]; then
    _workspace="$(get_workspace "${_file}")"
    for _test in ${STAGED_TESTS}; do
      _tworkspace="$(get_workspace "${_test}")"
      if [ "${_tworkspace}" = "${_workspace}" ]; then
        _found=1
        break
      fi
    done
  fi

  if [ "${_found}" -eq 0 ]; then
    printf '❌ T1 : "%s" est commité sans test ("%s.test.*" absent du commit).\n' \
      "${_file}" "${_base}" >&2
    MISSING=1
    MISSING_LIST="${MISSING_LIST}  - ${_file}\n"
  fi

done << STAGED_EOF
${STAGED_STATUS}
STAGED_EOF

if [ "${MISSING}" -eq 1 ]; then
  printf '\n' >&2
  printf 'Fichiers sans test:\n%b\n' "${MISSING_LIST}" >&2
  printf 'Règle T1 (CLAUDE.md §4) : code + test + doc = un seul commit.\n' >&2
  printf 'Ajoute les tests au commit, ou marque le fichier exempté\n' >&2
  printf '(generated/, migrations/, *.d.ts, *.config.*, barrel index.ts).\n' >&2
  printf 'Exemptions permanentes → lefthook/test-exemptions.txt\n' >&2
  exit 1
fi

exit 0
