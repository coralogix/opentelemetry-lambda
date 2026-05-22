#!/bin/bash

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)

if command -v rg >/dev/null 2>&1; then
  SEARCH_BIN=(rg -n -S)
else
  SEARCH_BIN=(grep -RInE)
fi

SOURCE_PATTERNS=(
  "createHash\\(['\\\"](md4|md5|sha1|ripemd|ripemd160)['\\\"]"
  "createHmac\\(['\\\"](md4|md5|sha1|ripemd|ripemd160)['\\\"]"
  "createCipheriv\\(['\\\"](des|des-|3des|rc2|rc4|bf|blowfish|idea)"
  "createDecipheriv\\(['\\\"](des|des-|3des|rc2|rc4|bf|blowfish|idea)"
)

SOURCE_TARGETS=(
  "$ROOT_DIR/nodejs/packages"
)

if [ -n "${OPENTELEMETRY_JS_PATH:-}" ] && [ -d "${OPENTELEMETRY_JS_PATH}" ]; then
  SOURCE_TARGETS+=(
    "$OPENTELEMETRY_JS_PATH/packages"
    "$OPENTELEMETRY_JS_PATH/experimental"
  )
fi

if [ -n "${OPENTELEMETRY_JS_CONTRIB_PATH:-}" ] && [ -d "${OPENTELEMETRY_JS_CONTRIB_PATH}" ]; then
  SOURCE_TARGETS+=(
    "$OPENTELEMETRY_JS_CONTRIB_PATH/packages"
  )
fi

scan_targets() {
  local label="$1"
  shift
  local -a targets=("$@")
  local -a args=()
  local pattern

  if [ "${#targets[@]}" -eq 0 ]; then
    return 0
  fi

  if [ "${SEARCH_BIN[0]}" = "rg" ]; then
    args=(
      --glob '!**/test/**'
      --glob '!**/tests/**'
      --glob '!**/__tests__/**'
      --glob '!**/benchmark/**'
      --glob '!**/benchmarks/**'
      --glob '!**/example/**'
      --glob '!**/examples/**'
      --glob '!**/docs/**'
      --glob '!**/doc/**'
      --glob '!**/*.map'
      --glob '!**/package-lock.json'
      --glob '!**/npm-shrinkwrap.json'
    )

    for pattern in "${SOURCE_PATTERNS[@]}"; do
      args+=(-e "$pattern")
    done

    if "${SEARCH_BIN[@]}" "${args[@]}" "${targets[@]}"; then
      echo "FIPS compatibility check failed in ${label}" >&2
      return 1
    fi

    return 0
  fi

  for pattern in "${SOURCE_PATTERNS[@]}"; do
    if "${SEARCH_BIN[@]}" "$pattern" "${targets[@]}"; then
      echo "FIPS compatibility check failed in ${label}" >&2
      return 1
    fi
  done
}

echo "Running Node.js FIPS compatibility check"

scan_targets "source trees" "${SOURCE_TARGETS[@]}"

LAYER_ZIP="$ROOT_DIR/nodejs/packages/layer/build/layer.zip"
if [ -f "$LAYER_ZIP" ]; then
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT
  unzip -q "$LAYER_ZIP" -d "$TMP_DIR"
  scan_targets "packaged layer" "$TMP_DIR"
fi

echo "Node.js FIPS compatibility check passed"
