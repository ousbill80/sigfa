#!/usr/bin/env bash
# run-schemathesis.sh — Invoque Schemathesis via l'image Docker officielle.
# Usage: ./run-schemathesis.sh [chemin/vers/contract.yaml]
#
# Sans argument  → exit 0 + message SKIP référençant CONTRACT-009
# Sans Docker    → exit 1 + message explicite
# Avec YAML      → invoque schemathesis/schemathesis via Docker

set -euo pipefail

YAML_PATH="${1:-}"

# Cas SKIP : aucun contrat YAML fourni
if [[ -z "$YAML_PATH" ]]; then
  echo "SKIP: aucun contrat OpenAPI — voir CONTRACT-009"
  exit 0
fi

# Vérifie Docker
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker introuvable. Docker est requis pour exécuter Schemathesis." >&2
  echo "Installez Docker >= 24 et réessayez." >&2
  exit 1
fi

# Vérifie que le fichier YAML existe
if [[ ! -f "$YAML_PATH" ]]; then
  echo "ERROR: Fichier de contrat introuvable: $YAML_PATH" >&2
  exit 1
fi

YAML_ABS="$(cd "$(dirname "$YAML_PATH")" && pwd)/$(basename "$YAML_PATH")"

echo "Running Schemathesis against: $YAML_ABS"
docker run --rm \
  -v "${YAML_ABS}:/contract.yaml:ro" \
  schemathesis/schemathesis \
  run /contract.yaml
