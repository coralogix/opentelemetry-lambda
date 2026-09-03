#!/bin/bash
# This script deploys the Node.js Lambda layer for OpenTelemetry instrumentation
#
# Required env vars:
# - LAMBDA_LAYER_PREFIX: Prefix for the Lambda layer name
# - AWS_PROFILE: AWS profile to use for deployment
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)

if [ -z "$LAMBDA_LAYER_PREFIX" ]; then
    echo "LAMBDA_LAYER_PREFIX is not set"
    exit 1
fi

if [ -z "${AWS_PROFILE:-}" ]; then
    export AWS_PROFILE=default
    echo "AWS_PROFILE not set, using default: $AWS_PROFILE"
fi

"$ROOT_DIR/dev/build-nodejs.sh"

output=$(aws lambda publish-layer-version \
  --layer-name "$LAMBDA_LAYER_PREFIX-coralogix-opentelemetry-nodejs-wrapper-development" \
  --compatible-architectures x86_64 arm64 \
  --compatible-runtimes nodejs22.x nodejs24.x nodejs26.x \
  --zip-file fileb://nodejs/packages/layer/build/layer.zip \
  --region eu-west-1 \
  --profile "$AWS_PROFILE" \
  --output json)
versionArn=$(echo "$output" | jq -r .LayerVersionArn)
echo "$versionArn"
