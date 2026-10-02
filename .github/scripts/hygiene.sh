#!/usr/bin/env bash
# Tracked-file hygiene scan (adapted from twzrd-sol/attention-oracle-program public-hygiene.yml, MIT).
# MODE=public also refuses internal paths, host names and non-local IPv4 literals in docs.
set -euo pipefail
MODE="${MODE:-private}"
fail=0
mapfile -t FILES < <(git ls-files)
bad=$(printf '%s\n' "${FILES[@]}" | grep -E '(^|/)\.env($|[./])' | grep -Ev '(^|/)\.env\.example$' || true)
[ -n "$bad" ] && { echo "::error::.env-style files tracked:"; echo "$bad"; fail=1; }
bad=$(printf '%s\n' "${FILES[@]}" | grep -E '(^|/)[^/]*(keypair|secret|private)[^/]*\.(json|pem|key)$|(^|/)[^/]*\.(pem|p12|key)$' || true)
[ -n "$bad" ] && { echo "::error::possible key-material paths:"; echo "$bad"; fail=1; }
bad=$(git ls-files -z | xargs -0 grep -lIP 'B[E]GIN [A-Z ]*PRIVATE KEY|O[P]ENSSH PRIVATE KEY|\bdp\.(st|ct|pt|sa)\.[A-Za-z0-9]{20,}|Authori[z]ation:\s*Bearer\s+[A-Za-z0-9._-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{32,}|hooks\.sl[a]ck\.com/services/' || true)
[ -n "$bad" ] && { echo "::error::possible hardcoded secrets in:"; echo "$bad"; fail=1; }
# A 64-number JSON array is the shape of a Solana keypair file.
bad=$(git ls-files -z '*.json' | xargs -0 -r grep -lIP '^\s*\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]\s*$' || true)
[ -n "$bad" ] && { echo "::error::keypair-shaped JSON tracked:"; echo "$bad"; fail=1; }
if [ "$MODE" = public ]; then
  bad=$(git ls-files -z | xargs -0 grep -nIiP '/home/[a-z]+/|twzrd[b]attleship|\btail[n]et\b|\bdo[p]pler\b|ansem-radio-pri[v]ate' || true)
  [ -n "$bad" ] && { echo "::error::internal paths, hosts or tooling named:"; echo "$bad"; fail=1; }
  docs=$(git ls-files | grep -E '(^|/)(README[^/]*|[^/]*\.md|[^/]*\.txt|[^/]*\.ya?ml|[^/]*\.toml)$' || true)
  bad=$(printf '%s\n' "$docs" | sed '/^$/d' | xargs -r grep -nIP '\b(?!(?:127\.0\.0\.1|0\.0\.0\.0)\b)(?:\d{1,3}\.){3}\d{1,3}\b' || true)
  [ -n "$bad" ] && { echo "::error::non-local IPv4 literals in docs:"; echo "$bad"; fail=1; }
fi
[ "$fail" = 0 ] && echo "hygiene: ok ($MODE, ${#FILES[@]} tracked files)"
exit $fail
