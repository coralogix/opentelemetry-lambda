#!/bin/bash
# This script builds the OpenTelemetry Java layers.
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
JAVA_INSTRUMENTATION_PATH="$ROOT_DIR/../opentelemetry-java-instrumentation"

if [ ! -d "$JAVA_INSTRUMENTATION_PATH" ]; then
    git clone git@github.com:coralogix/opentelemetry-java-instrumentation.git "$JAVA_INSTRUMENTATION_PATH" -b coralogix-autoinstrumentation -b coralogix-instrumentation
fi

echo "Publishing OpenTelemetry Java instrumentation to Maven local"
pushd "$JAVA_INSTRUMENTATION_PATH"
./gradlew publishToMavenLocal
popd

echo "Building Java agent layer"
pushd "$ROOT_DIR/java"
./gradlew :layer-javaagent:assemble
popd
