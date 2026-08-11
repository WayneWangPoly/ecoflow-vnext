#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo 'usage: transform-007-apply-pending-to-shadow.sh <pending-versions-file> <migrations-directory>'
  exit 64
fi

pending_versions_file="$1"
migrations_directory="$2"

test -n "${SHADOW_DB_URL:-}" || {
  echo 'SHADOW_DB_URL is required.'
  exit 64
}
test -f "$pending_versions_file" || {
  echo "Pending versions file not found: $pending_versions_file"
  exit 66
}
test -d "$migrations_directory" || {
  echo "Migrations directory not found: $migrations_directory"
  exit 66
}

declare -a pending_versions=()
declare -A seen_versions=()
while IFS= read -r version || [[ -n "$version" ]]; do
  test -n "$version" || continue
  [[ "$version" =~ ^[0-9]{14}$ ]] || {
    echo "Invalid pending migration version: $version"
    exit 65
  }
  if [[ -v "seen_versions[$version]" ]]; then
    echo "Duplicate pending migration version: $version"
    exit 65
  fi
  seen_versions["$version"]=1
  pending_versions+=("$version")
done < "$pending_versions_file"

applied_count=0
for version in "${pending_versions[@]}"; do
  mapfile -t migration_files < <(
    find "$migrations_directory" -maxdepth 1 -type f -name "${version}_*.sql" -print | sort
  )
  if [[ "${#migration_files[@]}" -ne 1 ]]; then
    echo "Expected exactly one pending migration file for $version; found ${#migration_files[@]}."
    exit 65
  fi

  file="${migration_files[0]}"
  echo "Applying $file to local PostgreSQL 17 shadow"
  psql "$SHADOW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$file"
  applied_count=$((applied_count + 1))
done

echo "Applied $applied_count pending migration(s) to the local shadow."
