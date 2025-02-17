#!/bin/bash
# This script deploys the Node.js Lambda layer for OpenTelemetry instrumentation
#
# Required env vars:
# - LAMBDA_LAYER_PREFIX: Prefix for the Lambda layer name
# - AWS_PROFILE: AWS profile to use for deployment

set -euo pipefail

# Check required environment variables
if [ -z "${AWS_PROFILE:-}" ]; then
    echo "Error: AWS_PROFILE is not set."
    exit 1
fi

if [ -z "${LAMBDA_LAYER_PREFIX:-}" ]; then
    echo "Error: LAMBDA_LAYER_PREFIX is not set"
    exit 1
fi

ROOT_DIR=$(git rev-parse --show-toplevel)
"$ROOT_DIR/dev/build-java.sh"


output=$(aws lambda publish-layer-version \
  --layer-name "$LAMBDA_LAYER_PREFIX-coralogix-opentelemetry-java-wrapper-development" \
  --compatible-architectures x86_64 arm64 \
  --compatible-runtimes java8 java8.al2 java11 java17 \
  --zip-file fileb://java/layer-javaagent/build/distributions/opentelemetry-javaagent-layer.zip \
  --region eu-west-1)
versionArn=$(echo "$output" | jq -r .LayerVersionArn)
echo "$versionArn"
