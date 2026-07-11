#!/usr/bin/env bash
# Hook PreToolUse (matcher: Edit|Write|MultiEdit) — thread principal uniquement.
# Les subagents ne portent pas ce hook : eux seuls peuvent écrire dans le code.
# Force le pattern orchestrateur même en fin de longue session.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  */apps/*|*/packages/*)
    echo "BLOQUÉ : l'orchestrateur ne modifie jamais apps/ ou packages/." >&2
    echo "Dispatche un subagent (voir CLAUDE.md §2 Routage du travail)." >&2
    exit 2   # exit 2 = bloque l'appel d'outil et renvoie le message au modèle
    ;;
esac
exit 0
