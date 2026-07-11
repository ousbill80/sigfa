#!/usr/bin/env bash
# Hook pre-commit (à lier aussi via husky/lefthook côté git).
# Règle T1 : tout fichier source ajouté/modifié doit avoir un fichier
# de test touché dans le même commit. Un code sans test n'existe pas.

STAGED=$(git diff --cached --name-only --diff-filter=ACM)
SRC=$(echo "$STAGED" | grep -E '^(apps|packages)/.*\.(ts|tsx)$' \
      | grep -vE '\.(test|spec)\.(ts|tsx)$' \
      | grep -vE '(\.d\.ts$|/generated/|/migrations/|\.config\.)' || true)
[ -z "$SRC" ] && exit 0

TESTS=$(echo "$STAGED" | grep -E '\.(test|spec)\.(ts|tsx)$' || true)
MISSING=0
for f in $SRC; do
  base=$(basename "$f" | sed -E 's/\.(ts|tsx)$//')
  if ! echo "$TESTS" | grep -q "$base"; then
    echo "❌ T1 : '$f' est commité sans test ('$base.test.*' absent du commit)." >&2
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo "" >&2
  echo "Règle T1 (CLAUDE.md §4) : code + test + doc = un seul commit." >&2
  echo "Ajoute les tests au commit, ou marque le fichier exempté" >&2
  echo "(generated/, migrations/, *.d.ts, *.config.*)." >&2
  exit 1
fi
exit 0
