#!/bin/bash

set -euo pipefail

if [ -z "${OPENTELEMETRY_JS_CONTRIB_PATH:-}" ]; then
    echo "OPENTELEMETRY_JS_CONTRIB_PATH is not set"
    exit 1
fi
OPENTELEMETRY_JS_CONTRIB_PATH=$(realpath $OPENTELEMETRY_JS_CONTRIB_PATH)

if [ -z "${OPENTELEMETRY_JS_PATH:-}" ]; then
    echo "OPENTELEMETRY_JS_PATH is not set"
    exit 1
fi

OPENTELEMETRY_JS_PATH=$(realpath $OPENTELEMETRY_JS_PATH)

if [ -z "${IITM_PATH:-}" ]; then
    echo "IITM_PATH is not set"
    exit 1
fi

IITM_PATH=$(realpath $IITM_PATH)

CWD=$(pwd)

echo OPENTELEMETRY_JS_CONTRIB_PATH=$OPENTELEMETRY_JS_CONTRIB_PATH
echo OPENTELEMETRY_JS_PATH=$OPENTELEMETRY_JS_PATH
echo IITM_PATH=$IITM_PATH
echo CWD=$CWD

npm cache clean --force

pushd $OPENTELEMETRY_JS_CONTRIB_PATH > /dev/null
# Generate version files in opentelemetry-js-contrib
npx lerna@6.6.2 run version:update # Newer versions have trouble with our lerna.json which contains `useWorkspaces`
# Prepare opentelemetry-js-contrib
npm install
popd > /dev/null

# Build opentelemetry-test-utils
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/packages/opentelemetry-test-utils
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-propagator-aws-xray
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/propagators/opentelemetry-propagator-aws-xray
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-propagation-utils
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/packages/opentelemetry-propagation-utils
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-instrumentation-aws-lambda
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/plugins/node/opentelemetry-instrumentation-aws-lambda
rm -f opentelemetry-instrumentation-aws-lambda-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Build opentelemetry-instrumentation-mongodb
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/plugins/node/opentelemetry-instrumentation-mongodb
rm -f opentelemetry-instrumentation-mongodb-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Build opentelemetry-instrumentation-aws-sdk
pushd $OPENTELEMETRY_JS_CONTRIB_PATH/plugins/node/opentelemetry-instrumentation-aws-sdk
rm -f opentelemetry-instrumentation-aws-sdk-*.tgz
npm install --ignore-scripts && npm run compile && npm pack --ignore-scripts
popd > /dev/null

# Prepare opentelemetry-js
pushd $OPENTELEMETRY_JS_PATH
npm install
popd > /dev/null

# Build sdk-logs
pushd $OPENTELEMETRY_JS_PATH/experimental/packages/sdk-logs
npm install && npm run compile
popd > /dev/null

# Build opentelemetry-instrumentation
pushd $OPENTELEMETRY_JS_PATH/experimental/packages/opentelemetry-instrumentation
rm -f opentelemetry-instrumentation-*.tgz
npm install && npm run compile && npm pack
popd > /dev/null

# Build opentelemetry-sdk-trace-base
pushd $OPENTELEMETRY_JS_PATH/packages/opentelemetry-sdk-trace-base
rm -f opentelemetry-sdk-trace-base-*.tgz
npm install && npm run compile && npm pack
popd > /dev/null

# Build import-in-the-middle
pushd $IITM_PATH
rm -f import-in-the-middle-*.tgz
npm install && npm pack
popd > /dev/null

# Build cx-aws-user-function
pushd ./nodejs/packages/cx-aws-user-function
rm -f cx-aws-user-function-*.tgz
npm install && npm pack
popd > /dev/null

# Install forked libraries in cx-wrapper
pushd ./nodejs/packages/cx-wrapper
npm install \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-aws-lambda/opentelemetry-instrumentation-aws-lambda-*.tgz \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-mongodb/opentelemetry-instrumentation-mongodb-*.tgz \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-aws-sdk/opentelemetry-instrumentation-aws-sdk-*.tgz \
    ${OPENTELEMETRY_JS_PATH}/experimental/packages/opentelemetry-instrumentation/opentelemetry-instrumentation-*.tgz \
    ${OPENTELEMETRY_JS_PATH}/packages/opentelemetry-sdk-trace-base/opentelemetry-sdk-trace-base-*.tgz \
    ${IITM_PATH}/import-in-the-middle-*.tgz \
    ${CWD}/nodejs/packages/cx-aws-user-function/cx-aws-user-function-*.tgz
popd > /dev/null

# Build cx-wrapper
pushd ./nodejs/packages/cx-wrapper
rm -f cx-wrapper-*.tgz
npm install && npm pack
popd > /dev/null

# Install cx-wrapper in layer
pushd ./nodejs/packages/layer
npm install \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-aws-lambda/opentelemetry-instrumentation-aws-lambda-*.tgz \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-mongodb/opentelemetry-instrumentation-mongodb-*.tgz \
    ${OPENTELEMETRY_JS_CONTRIB_PATH}/plugins/node/opentelemetry-instrumentation-aws-sdk/opentelemetry-instrumentation-aws-sdk-*.tgz \
    ${OPENTELEMETRY_JS_PATH}/experimental/packages/opentelemetry-instrumentation/opentelemetry-instrumentation-*.tgz \
    ${OPENTELEMETRY_JS_PATH}/packages/opentelemetry-sdk-trace-base/opentelemetry-sdk-trace-base-*.tgz \
    ${IITM_PATH}/import-in-the-middle-*.tgz \
    ${CWD}/nodejs/packages/cx-aws-user-function/cx-aws-user-function-*.tgz \
    ${CWD}/nodejs/packages/cx-wrapper/cx-wrapper-*.tgz
popd > /dev/null

# Install copyfiles and bestzip # used by `npm run compile`
npm install -g copyfiles bestzip

# Build layer
pushd ./nodejs/packages/layer
npm install && npm run compile
popd > /dev/null