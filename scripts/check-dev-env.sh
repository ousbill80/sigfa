#!/usr/bin/env bash
# SIGFA — check-dev-env.sh
# INFRA-002 : Valide l'environnement de développement Docker Compose
#
# Vérifie :
#   1. docker compose config valide (exit 0)
#   2. Services postgres et redis en état healthy
#   3. SELECT 1 sur postgres (connectivité réelle)
#   4. PING sur redis → PONG (connectivité réelle)
#
# Exit 0 = tout est OK
# Exit 1 = au moins une vérification a échoué (message clair sur stderr)
#
# Variables d'environnement optionnelles :
#   COMPOSE_FILE          — chemin vers docker-compose.yml (défaut : repo root)
#   COMPOSE_PROJECT_NAME  — nom du projet compose (défaut : répertoire courant)

set -euo pipefail

# ---------------------------------------------------------------------------
# Couleurs (désactivées si pas de terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

ERRORS=0

log_ok()   { printf "${GREEN}[OK]${NC}  %s\n" "$1"; }
log_fail() { printf "${RED}[FAIL]${NC} %s\n" "$1" >&2; ERRORS=$((ERRORS + 1)); }
log_info() { printf "${YELLOW}[INFO]${NC} %s\n" "$1"; }

# ---------------------------------------------------------------------------
# Résoudre le répertoire racine du repo (répertoire parent de ce script)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"

# Construire les arguments compose communs
COMPOSE_ARGS=("-f" "${COMPOSE_FILE}")
if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  COMPOSE_ARGS+=("-p" "${COMPOSE_PROJECT_NAME}")
fi

log_info "Racine repo     : ${REPO_ROOT}"
log_info "Compose file    : ${COMPOSE_FILE}"
log_info "Projet compose  : ${COMPOSE_PROJECT_NAME:-<défaut>}"
echo ""

# ---------------------------------------------------------------------------
# 1. Vérification : docker compose config valide
# ---------------------------------------------------------------------------
log_info "1/4 — Vérification docker compose config..."
if docker compose "${COMPOSE_ARGS[@]}" config --quiet 2>/dev/null; then
  log_ok "docker compose config valide (exit 0)"
else
  log_fail "docker compose config a échoué — vérifiez docker-compose.yml"
fi

# ---------------------------------------------------------------------------
# 2. Vérification : postgres est healthy
# ---------------------------------------------------------------------------
log_info "2/4 — Vérification état postgres..."
POSTGRES_HEALTH=$(docker compose "${COMPOSE_ARGS[@]}" ps --format json 2>/dev/null \
  | grep -o '"Health":"[^"]*"' | grep postgres | grep -o '"[^"]*"$' | tr -d '"' 2>/dev/null || true)

# Méthode alternative si la première ne fonctionne pas
if [ -z "${POSTGRES_HEALTH}" ]; then
  POSTGRES_STATUS=$(docker compose "${COMPOSE_ARGS[@]}" ps postgres 2>/dev/null | tail -1 || true)
  if echo "${POSTGRES_STATUS}" | grep -q "healthy"; then
    POSTGRES_HEALTH="healthy"
  elif echo "${POSTGRES_STATUS}" | grep -q "Up"; then
    POSTGRES_HEALTH="running"
  else
    POSTGRES_HEALTH="not_running"
  fi
fi

# Vérification directe via pg_isready
POSTGRES_CONTAINER=$(docker compose "${COMPOSE_ARGS[@]}" ps -q postgres 2>/dev/null | head -1 || true)
if [ -n "${POSTGRES_CONTAINER}" ]; then
  if docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER:-sigfa}" -d "${POSTGRES_DB:-sigfa}" -q 2>/dev/null; then
    log_ok "postgres est healthy (pg_isready OK)"
  else
    log_fail "postgres ne répond pas à pg_isready — service en cours de démarrage ou arrêté ?"
  fi
else
  log_fail "postgres container introuvable — le service est-il démarré ? (docker compose up -d postgres)"
fi

# ---------------------------------------------------------------------------
# 3. Vérification : SELECT 1 sur postgres
# ---------------------------------------------------------------------------
log_info "3/4 — Vérification connexion postgres (SELECT 1)..."
if [ -n "${POSTGRES_CONTAINER}" ]; then
  if docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER:-sigfa}" -d "${POSTGRES_DB:-sigfa}" -c "SELECT 1" -q --tuples-only 2>/dev/null | grep -q "1"; then
    log_ok "postgres : SELECT 1 → 1 (connexion OK)"
  else
    log_fail "postgres : SELECT 1 a échoué — base inaccessible ou utilisateur invalide"
  fi
else
  log_fail "postgres : SELECT 1 impossible — container introuvable"
fi

# ---------------------------------------------------------------------------
# 4. Vérification : PING sur redis → PONG
# ---------------------------------------------------------------------------
log_info "4/4 — Vérification connexion redis (PING)..."
REDIS_CONTAINER=$(docker compose "${COMPOSE_ARGS[@]}" ps -q redis 2>/dev/null | head -1 || true)
if [ -n "${REDIS_CONTAINER}" ]; then
  REDIS_RESPONSE=$(docker exec "${REDIS_CONTAINER}" redis-cli ping 2>/dev/null | tr -d '[:space:]' || true)
  if [ "${REDIS_RESPONSE}" = "PONG" ]; then
    log_ok "redis : PING → PONG (connexion OK)"
  else
    log_fail "redis : PING a répondu '${REDIS_RESPONSE}' au lieu de 'PONG' — service healthy ?"
  fi
else
  log_fail "redis container introuvable — le service est-il démarré ? (docker compose up -d redis)"
fi

# ---------------------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------------------
echo ""
if [ "${ERRORS}" -eq 0 ]; then
  printf "${GREEN}Environnement dev OK — toutes les vérifications ont réussi.${NC}\n"
  exit 0
else
  printf "${RED}${ERRORS} vérification(s) ont échoué. Consultez les messages [FAIL] ci-dessus.${NC}\n" >&2
  printf "${YELLOW}Conseil : docker compose up -d postgres redis && docker compose ps${NC}\n" >&2
  exit 1
fi
