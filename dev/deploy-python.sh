#!/bin/bash
# This script deploys the Python Lambda layer for OpenTelemetry instrumentation
#
# Required env vars:
# - LAMBDA_LAYER_PREFIX: Prefix for the Lambda layer name
# - AWS_PROFILE: AWS profile to use for deployment
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
"$ROOT_DIR/dev/build-python.sh"

output=$(aws lambda publish-layer-version \
  --layer-name "$LAMBDA_LAYER_PREFIX-coralogix-opentelemetry-python-wrapper-development" \
  --compatible-architectures x86_64 arm64 \
  --compatible-runtimes python3.8 python3.9 python3.10 python3.11 python3.12 python3.13 \
  --zip-file fileb://python/sample-apps/otel/build/layer.zip \
  --region eu-west-1 \
  --profile "$AWS_PROFILE" \
  --output json)
versionArn=$(echo "$output" | jq -r .LayerVersionArn)
echo "$versionArn"
