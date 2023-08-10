#!/bin/bash

set -euo pipefail

#export AWS_PROFILE="prod" # not setting profile, expecting credentials to be set in env vars during github action execution
export NAME_SUFFIX=""
export PUBLIC=true

export REGIONS=("ap-south-1" "eu-north-1" "eu-west-3" "eu-west-2" "eu-west-1" "ap-northeast-3" "ap-northeast-2" "ap-northeast-1" "ca-central-1" "sa-east-1" "ap-southeast-1" "ap-southeast-2" "eu-central-1" "us-east-1" "us-east-2" "us-west-1" "us-west-2" "af-south-1" "ap-east-1" "ap-southeast-3" "eu-south-1" "me-south-1" "il-central-1")
export LIMITED_REGION=false
# shellcheck source=/dev/null
. "${BASH_SOURCE%/*}/publish_layer.sh"

export REGIONS=("ap-south-2" "ap-southeast-4" "eu-central-2" "eu-south-2" "me-central-1")
export LIMITED_REGION=true
# shellcheck source=/dev/null
. "${BASH_SOURCE%/*}/publish_layer.sh"
