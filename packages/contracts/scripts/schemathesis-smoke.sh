#!/usr/bin/env bash
# schemathesis-smoke.sh — CONTRACT-009b
# Pour chaque bundle, lance la fumée Schemathesis contre le mock Prism correspondant.
#
# Utilise le harness F0 : packages/testing/src/contract/run-schemathesis.sh
# macOS : le mock local se joint depuis le conteneur via http://host.docker.internal:<port>
#
# Usage : ./scripts/schemathesis-smoke.sh [--only <module>]
#   Sans argument : fumée sur tous les 7 modules
#   --only core    : fumée sur le seul module 'core'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLED_DIR="${CONTRACTS_DIR}/generated/bundled"
PRISM_BIN="${CONTRACTS_DIR}/node_modules/.bin/prism"

# Ports par défaut (surchargeable via env)
MOCK_CORE_PORT="${MOCK_CORE_PORT:-4010}"
MOCK_PUBLIC_PORT="${MOCK_PUBLIC_PORT:-4011}"
MOCK_AGENTS_PORT="${MOCK_AGENTS_PORT:-4012}"
MOCK_ADMIN_PORT="${MOCK_ADMIN_PORT:-4013}"
MOCK_REPORTING_PORT="${MOCK_REPORTING_PORT:-4014}"
MOCK_NOTIFICATIONS_PORT="${MOCK_NOTIFICATIONS_PORT:-4015}"
MOCK_AI_PORT="${MOCK_AI_PORT:-4016}"

declare -A MODULE_PORTS=(
  [core]="${MOCK_CORE_PORT}"
  [public]="${MOCK_PUBLIC_PORT}"
  [agents]="${MOCK_AGENTS_PORT}"
  [admin]="${MOCK_ADMIN_PORT}"
  [reporting]="${MOCK_REPORTING_PORT}"
  [notifications]="${MOCK_NOTIFICATIONS_PORT}"
  [ai]="${MOCK_AI_PORT}"
)

MODULES=("core" "public" "agents" "admin" "reporting" "notifications" "ai")

# Filtre --only <module> si fourni
ONLY_MODULE=""
if [[ "${1:-}" == "--only" && -n "${2:-}" ]]; then
  ONLY_MODULE="$2"
  MODULES=("$ONLY_MODULE")
fi

# Vérifier Docker
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker introuvable. Docker est requis pour exécuter Schemathesis." >&2
  exit 1
fi

# Sur macOS, docker-credential-desktop peut être un lien brisé — désactiver le credsStore
if [[ -z "${DOCKER_CONFIG:-}" ]]; then
  SIGFA_DOCKER_CONFIG="/tmp/sigfa-docker-nocreds"
  mkdir -p "${SIGFA_DOCKER_CONFIG}"
  echo '{"auths":{}}' > "${SIGFA_DOCKER_CONFIG}/config.json"
  export DOCKER_CONFIG="${SIGFA_DOCKER_CONFIG}"
fi

# Vérifier Prism
if [[ ! -f "${PRISM_BIN}" ]]; then
  echo "ERROR: prism CLI introuvable : ${PRISM_BIN}" >&2
  echo "  Lancez 'pnpm install' d'abord." >&2
  exit 1
fi

# Tableau des PIDs Prism démarrés par ce script (pour nettoyage)
declare -a PRISM_PIDS=()

cleanup() {
  echo ""
  echo "[schemathesis-smoke] Nettoyage des instances Prism…"
  for pid in "${PRISM_PIDS[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  # Supprimer les conteneurs Docker orphelins schemathesis
  docker ps -q --filter "ancestor=schemathesis/schemathesis" | xargs -r docker stop 2>/dev/null || true
  echo "[schemathesis-smoke] Nettoyage terminé."
}
trap cleanup EXIT INT TERM

# Attendre qu'un port soit accessible
wait_for_port() {
  local port="$1"
  local timeout_s="${2:-20}"
  local deadline=$(( $(date +%s) + timeout_s ))
  while [[ $(date +%s) -lt ${deadline} ]]; do
    if curl -s --connect-timeout 1 "http://127.0.0.1:${port}/" &>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "  WARN: port ${port} non accessible après ${timeout_s}s — Schemathesis va tenter quand même" >&2
  return 0
}

FAIL_COUNT=0
PASS_COUNT=0

for module in "${MODULES[@]}"; do
  bundle="${BUNDLED_DIR}/${module}.yaml"
  port="${MODULE_PORTS[$module]}"

  echo ""
  echo "══════════════════════════════════════════════"
  echo " Module : ${module}  |  Port : ${port}"
  echo "══════════════════════════════════════════════"

  if [[ ! -f "${bundle}" ]]; then
    echo "  ERROR: bundle introuvable : ${bundle}" >&2
    echo "  Lancez 'pnpm --filter @sigfa/contracts bundle' d'abord." >&2
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    continue
  fi

  # Démarrer Prism mock en arrière-plan
  echo "  ▶ Démarrage Prism mock ${module} sur port ${port}…"
  "${PRISM_BIN}" mock --port "${port}" --host 127.0.0.1 "${bundle}" &>/dev/null &
  prism_pid=$!
  PRISM_PIDS+=("${prism_pid}")

  # Attendre que Prism soit prêt
  wait_for_port "${port}" 15

  # URL Schemathesis : depuis le conteneur Docker sur macOS → host.docker.internal
  schema_url="http://host.docker.internal:${port}"

  echo "  ▶ Lancement Schemathesis (fumée) contre ${schema_url}…"
  echo "    Bundle : ${bundle}"

  bundle_abs="$(cd "$(dirname "${bundle}")" && pwd)/$(basename "${bundle}")"

  set +e
  docker run --rm \
    -v "${bundle_abs}:/contract.yaml:ro" \
    --add-host=host.docker.internal:host-gateway \
    schemathesis/schemathesis \
    run /contract.yaml \
    --url "${schema_url}" \
    --max-examples=1 \
    --checks=not_a_server_error \
    2>&1
  exit_code=$?
  set -e

  if [[ ${exit_code} -eq 0 ]]; then
    echo "  ✔ ${module} : Schemathesis OK"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ✘ ${module} : Schemathesis a détecté des non-conformités (exit ${exit_code})"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi

  # Arrêter le mock Prism du module
  kill "${prism_pid}" 2>/dev/null || true
  PRISM_PIDS=("${PRISM_PIDS[@]/$prism_pid}")
  sleep 0.5
done

echo ""
echo "══════════════════════════════════════════════"
echo " Résultat : ${PASS_COUNT} OK  /  ${FAIL_COUNT} ÉCHEC"
echo "══════════════════════════════════════════════"

if [[ ${FAIL_COUNT} -gt 0 ]]; then
  exit 1
fi
exit 0
