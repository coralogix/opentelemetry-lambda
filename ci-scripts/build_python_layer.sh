#!/bin/bash

set -euo pipefail

if [ -z "${OPENTELEMETRY_PYTHON_CONTRIB_PATH:-}" ]; then
    echo "OPENTELEMETRY_PYTHON_CONTRIB_PATH is not set"
    exit 1
fi
OPENTELEMETRY_PYTHON_CONTRIB_PATH=$(realpath $OPENTELEMETRY_PYTHON_CONTRIB_PATH)

CWD=$(pwd)

echo OPENTELEMETRY_PYTHON_CONTRIB_PATH=$OPENTELEMETRY_PYTHON_CONTRIB_PATH
echo CWD=$CWD


pushd ./python/sample-apps/otel
rm -rf build
rm -rf *.whl
pip3 wheel -e $OPENTELEMETRY_PYTHON_CONTRIB_PATH/instrumentation/opentelemetry-instrumentation-aws-lambda
pip3 wheel -e $OPENTELEMETRY_PYTHON_CONTRIB_PATH/instrumentation/opentelemetry-instrumentation-botocore
mkdir -p ./build
python3 -m pip install -r ./otel_sdk/requirements.txt -t ./build/python
python3 -m pip install -r ./otel_sdk/requirements-nodeps.txt -t ./build/tmp --no-deps
cp -r ./build/tmp/* ./build/python/
rm -rf ./build/tmp
cp ./otel_sdk/otel-instrument ./build/otel-instrument
chmod 755 ./build/otel-instrument
cp ./otel_sdk/otel-instrument ./build/otel-handler
chmod 755 ./build/otel-handler
cp ./otel_sdk/otel_wrapper.py ./build/python/
rm -rf ./build/python/boto*
rm -rf ./build/python/urllib3*
popd > /dev/null

pushd ./python/sample-apps/otel/build
zip -r layer.zip *
popd > /dev/null
