#!/bin/bash
# This script builds the Node.js Lambda layer for OpenTelemetry instrumentation
#
# The script expects the dependencies to be cloned in specific locations
# relative to this repository's root directory.

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)

# Expected by build_nodejs_layer.sh
if [ -z "$OPENTELEMETRY_JS_CONTRIB_PATH" ]; then
	export OPENTELEMETRY_JS_CONTRIB_PATH="$ROOT_DIR/opentelemetry-js-contrib-cx"
fi

if [ -z "$OPENTELEMETRY_JS_PATH" ]; then
	export OPENTELEMETRY_JS_PATH="$ROOT_DIR/opentelemetry-js"
fi

if [ -z "$IITM_PATH" ]; then
	export IITM_PATH="$ROOT_DIR/import-in-the-middle"
fi

if [ ! -d "$OPENTELEMETRY_JS_CONTRIB_PATH" ]; then
	git clone git@github.com:coralogix/opentelemetry-js-contrib.git "$OPENTELEMETRY_JS_CONTRIB_PATH" -b coralogix-autoinstrumentation
fi

if [ ! -d "$OPENTELEMETRY_JS_PATH" ]; then
	git clone git@github.com:coralogix/opentelemetry-js.git "$OPENTELEMETRY_JS_PATH" -b coralogix-autoinstrumentation
fi

if [ ! -d "$IITM_PATH" ]; then
	git clone git@github.com:coralogix/import-in-the-middle.git "$IITM_PATH" -b coralogix-autoinstrumentation
fi

"$ROOT_DIR/ci-scripts/build_nodejs_layer.sh"

# Useful for using the layer locally
pushd "$ROOT_DIR/nodejs/packages/layer" >/dev/null
rm -rf ./build/layer && unzip -q ./build/layer.zip -d ./build/layer
popd >/dev/null
