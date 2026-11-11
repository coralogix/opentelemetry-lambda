#!/bin/bash

set -euo pipefail

if [ -z "${OPENTELEMETRY_JS_CONTRIB_PATH:-}" ]; then
    echo "OPENTELEMETRY_JS_CONTRIB_PATH is not set"
    exit 1
fi
OPENTELEMETRY_JS_CONTRIB_PATH=$(realpath "$OPENTELEMETRY_JS_CONTRIB_PATH")

if [ -z "${OPENTELEMETRY_JS_PATH:-}" ]; then
    echo "OPENTELEMETRY_JS_PATH is not set"
    exit 1
fi
OPENTELEMETRY_JS_PATH=$(realpath "$OPENTELEMETRY_JS_PATH")


CWD=$(pwd)

echo "OPENTELEMETRY_JS_CONTRIB_PATH=$OPENTELEMETRY_JS_CONTRIB_PATH"
echo "OPENTELEMETRY_JS_PATH=$OPENTELEMETRY_JS_PATH"
echo "CWD=$CWD"

# Explicit local archive arguments refresh same-version tarball integrity while
# keeping the portable file: references declared in each package manifest.
install_file_dependencies() {
    local -a archives=()
    local archive
    while IFS= read -r archive; do
        archives+=("$archive")
    done < <(node -e 'for (const dep of Object.values(require("./package.json").dependencies)) if (dep.startsWith("file:")) console.log(dep)')
    npm install "$@" "${archives[@]}"
}

pushd "$OPENTELEMETRY_JS_CONTRIB_PATH" > /dev/null
# Prepare opentelemetry-js-contrib
npm install
# Generate version files in opentelemetry-js-contrib
# Lerna 9 no longer requires useWorkspaces configuration - it uses npm workspaces by default
npm run version:update
popd > /dev/null

# Build contrib-test-utils
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/contrib-test-utils" > /dev/null
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-propagator-aws-xray
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/propagator-aws-xray" > /dev/null
npm install --ignore-scripts && npm run compile
popd > /dev/null

# Build opentelemetry-propagator-aws-xray-lambda
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/propagator-aws-xray-lambda" > /dev/null
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-instrumentation-aws-lambda
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/instrumentation-aws-lambda" > /dev/null
rm -f opentelemetry-instrumentation-aws-lambda-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Build opentelemetry-instrumentation-mongodb
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/instrumentation-mongodb" > /dev/null
rm -f opentelemetry-instrumentation-mongodb-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Build opentelemetry-instrumentation-aws-sdk
pushd "$OPENTELEMETRY_JS_CONTRIB_PATH/packages/instrumentation-aws-sdk" > /dev/null
rm -f opentelemetry-instrumentation-aws-sdk-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Prepare opentelemetry-js
pushd "$OPENTELEMETRY_JS_PATH" > /dev/null
npm install
# Generate version files in opentelemetry-js (required for TypeScript compilation)
npx nx run-many -t version
popd > /dev/null

# Build sdk-logs
pushd "$OPENTELEMETRY_JS_PATH/packages/sdk-logs" > /dev/null
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-instrumentation
pushd "$OPENTELEMETRY_JS_PATH/experimental/packages/opentelemetry-instrumentation" > /dev/null
rm -f opentelemetry-instrumentation-*.tgz
npm install && npm run compile && npm pack
ls -lah opentelemetry-instrumentation-*.tgz
popd > /dev/null

# Build cx-wrapper
pushd "./nodejs/packages/cx-wrapper" > /dev/null
rm -f cx-wrapper-*.tgz
install_file_dependencies && npm pack
popd > /dev/null

# Keep packaging tools local to this build instead of modifying global tools.
BUILD_TOOLS_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_TOOLS_DIR"' EXIT
npm install --prefix "$BUILD_TOOLS_DIR" --ignore-scripts --no-audit --no-fund \
    copyfiles@2.4.1 bestzip@2.2.1 rimraf@6.1.3
export PATH="$BUILD_TOOLS_DIR/node_modules/.bin:$PATH"

# Build layer
pushd "./nodejs/packages/layer" > /dev/null
npm run clean && install_file_dependencies --omit=dev
# Dedupe dependencies to remove duplicates and reduce size
npm dedupe
# Remove unnecessary files to reduce layer size
find node_modules -name "*.map" -delete
find node_modules -type d \( -name "test" -o -name "tests" -o -name "docs" -o -name "doc" \) -exec rm -rf {} + 2>/dev/null || true
# Rebuild layer with optimized dependencies
npm run clean && npm run compile
ls -lah build/layer.zip
popd > /dev/null
