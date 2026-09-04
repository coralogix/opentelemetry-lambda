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

npm cache clean --force

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
pushd "$OPENTELEMETRY_JS_PATH/experimental/packages/sdk-logs" > /dev/null
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-instrumentation
pushd "$OPENTELEMETRY_JS_PATH/experimental/packages/opentelemetry-instrumentation" > /dev/null
rm -f opentelemetry-instrumentation-*.tgz
npm install && npm run compile && npm pack
ls -lah opentelemetry-instrumentation-*.tgz
popd > /dev/null

# Build opentelemetry-sdk-trace-base
# pushd $OPENTELEMETRY_JS_PATH/packages/opentelemetry-sdk-trace-base
# rm -f opentelemetry-sdk-trace-base-*.tgz
# npm install && npm run compile && npm pack
# popd > /dev/null

# Install forked libraries in cx-wrapper
pushd "./nodejs/packages/cx-wrapper" > /dev/null
npm install \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-aws-lambda/opentelemetry-instrumentation-aws-lambda-*.tgz \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-mongodb/opentelemetry-instrumentation-mongodb-*.tgz \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-aws-sdk/opentelemetry-instrumentation-aws-sdk-*.tgz \
    "${OPENTELEMETRY_JS_PATH}"/experimental/packages/opentelemetry-instrumentation/opentelemetry-instrumentation-*.tgz
popd > /dev/null

# Build cx-wrapper
pushd "./nodejs/packages/cx-wrapper" > /dev/null
rm -f cx-wrapper-*.tgz
npm install && npm pack
popd > /dev/null

# Install libraries in layer
pushd "./nodejs/packages/layer" > /dev/null
npm install \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-aws-lambda/opentelemetry-instrumentation-aws-lambda-*.tgz \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-mongodb/opentelemetry-instrumentation-mongodb-*.tgz \
    "${OPENTELEMETRY_JS_CONTRIB_PATH}"/packages/instrumentation-aws-sdk/opentelemetry-instrumentation-aws-sdk-*.tgz \
    "${OPENTELEMETRY_JS_PATH}"/experimental/packages/opentelemetry-instrumentation/opentelemetry-instrumentation-*.tgz \
    "${CWD}"/nodejs/packages/cx-wrapper/cx-wrapper-*.tgz
popd > /dev/null

# Install copyfiles and bestzip # used by `npm run clean/compile`
npm install -g copyfiles bestzip rimraf

# Build layer
pushd "./nodejs/packages/layer" > /dev/null
npm run clean && npm install --production
# Dedupe dependencies to remove duplicates and reduce size
npm dedupe
# Remove unnecessary files to reduce layer size
find node_modules -name "*.map" -delete
find node_modules -type d \( -name "test" -o -name "tests" -o -name "docs" -o -name "doc" \) -exec rm -rf {} + 2>/dev/null || true
# Rebuild layer with optimized dependencies
npm run clean && npm run compile
ls -lah build/layer.zip
popd > /dev/null
