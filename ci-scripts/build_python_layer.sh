#!/bin/bash

set -x
set -euo pipefail

# This function removes the .dev suffix from version strings in the given directory.
# It is needed because how the releases are handled in the upstream repositories:
#   1. The work is done in the `main` branch. The packages in main are
#       versioned with the .dev suffix until a release is made. For instance,
#       `0.52b0.dev` is the version in `main`.
#   2. A release branch is created from `main` for each release. Commits from
#      the release branch are never merged back into `main`. If any changes are
#      needed in the release branch and in `main`, those commits are cherry-picked
#      from `main` into the release branch or the other way around.
#   3. The `.dev` suffix is removed from the version strings in the release branch.
#      For instance, if the version is `0.52b0.dev`, it is changed to `0.52b0`.
#   4. A release is made from the release branch.
#   5. The versions are updated in the `main` branch, keeping the `.dev` suffix. For instance,
#      if the version in `main` is `0.52b0.dev, after the release it will be 0.53b0.dev.
#
# Note this has some effects:
# - If we pull from the release branch into our fork, next time we pull from upstream it can
#   cause merge conflicts because the history of the branches are different.
# - If we try to build without removing the .dev suffix, we will get an error because
#   `<version>.dev` releases are not available via pip. We could install them from the folders
#   but it would involve some extra work because we also need to clone the core repo
#   and install the dependencies.
#
remove_dev_suffix() {
    local dir_path="$1"

    # sed command behavior is different on macOS and Linux
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local sed_args="-i .bak"
        cleanup_bak() {
            find "$1" -name "*.bak" -type f -delete
        }
    else
        local sed_args="-i"
        cleanup_bak() { :; }
    fi

    # "__version__ = x.y.z.dev" -> "__version__ = x.y.z"
    find "$dir_path" -type f -name "version.py" -exec sed "$sed_args" 's/__version__ = "\([^"]*\)\.dev"/__version__ = "\1"/g' {} \;
    
    # Modify pyproject.toml in the top-level directory only
    if [ -f "$dir_path/pyproject.toml" ]; then
        # "opentelemetry-package == x.y.z.dev" -> "opentelemetry-package == x.y.z"
        sed "$sed_args" 's/\(opentelemetry[^"]*\) == \([^"]*\)\.dev"/\1 == \2"/g' "$dir_path/pyproject.toml"
    fi

    cleanup_bak "$dir_path"
}

log() {
    local message="$1"
    local padding="###########################"
    echo "$padding $message $padding"
}

patch_protobuf_fips_hash_usage() {
    local build_python_path="$1"
    local proto_builder_path="$build_python_path/google/protobuf/proto_builder.py"

    if [ ! -f "$proto_builder_path" ]; then
        return
    fi

    python3 - "$proto_builder_path" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
needle = "  fields_hash = hashlib.sha1()\n"
replacement = """  try:\n    fields_hash = hashlib.sha1(usedforsecurity=False)\n  except TypeError:\n    fields_hash = hashlib.sha1()\n"""

text = path.read_text()
if needle not in text:
    raise SystemExit(0)

path.write_text(text.replace(needle, replacement, 1))
PY
}



if [ -z "${OPENTELEMETRY_PYTHON_CONTRIB_PATH:-}" ]; then
    echo "OPENTELEMETRY_PYTHON_CONTRIB_PATH is not set"
    exit 1
fi

OPENTELEMETRY_PYTHON_CONTRIB_PATH=$(realpath "$OPENTELEMETRY_PYTHON_CONTRIB_PATH")
CWD=$(pwd)

WORKSPACE_CONTRIB_COPY_PATH="$CWD/.build/opentelemetry-python-contrib"
rm -rf "$WORKSPACE_CONTRIB_COPY_PATH"
mkdir -p "$WORKSPACE_CONTRIB_COPY_PATH/instrumentation"
find "$OPENTELEMETRY_PYTHON_CONTRIB_PATH/instrumentation" \
    \( -name '*.bak' -o -name 'sed*' \) -type f -size 0 -delete
cp -R "$OPENTELEMETRY_PYTHON_CONTRIB_PATH/instrumentation/opentelemetry-instrumentation-aws-lambda" \
    "$WORKSPACE_CONTRIB_COPY_PATH/instrumentation/"
cp -R "$OPENTELEMETRY_PYTHON_CONTRIB_PATH/instrumentation/opentelemetry-instrumentation-botocore" \
    "$WORKSPACE_CONTRIB_COPY_PATH/instrumentation/"

AWS_LAMBDA_INSTRUMENTATION_PATH=$WORKSPACE_CONTRIB_COPY_PATH/instrumentation/opentelemetry-instrumentation-aws-lambda
BOTOCORE_INSTRUMENTATION_PATH=$WORKSPACE_CONTRIB_COPY_PATH/instrumentation/opentelemetry-instrumentation-botocore

log "Environment Variables"
echo "OPENTELEMETRY_PYTHON_CONTRIB_PATH=$OPENTELEMETRY_PYTHON_CONTRIB_PATH"
echo "CWD=$CWD"
echo "AWS_LAMBDA_INSTRUMENTATION_PATH=$AWS_LAMBDA_INSTRUMENTATION_PATH"
echo "BOTOCORE_INSTRUMENTATION_PATH=$BOTOCORE_INSTRUMENTATION_PATH"


pushd ./python/sample-apps/otel

log "Removing .dev suffix from version strings"
rm -rf build
rm -rf *.whl

log "Removing .dev suffix from version strings"
remove_dev_suffix "$AWS_LAMBDA_INSTRUMENTATION_PATH"
remove_dev_suffix "$BOTOCORE_INSTRUMENTATION_PATH"

log "Building Wheels for instrumentation libraries"
pip3 wheel "$AWS_LAMBDA_INSTRUMENTATION_PATH"
pip3 wheel "$BOTOCORE_INSTRUMENTATION_PATH"

log "Installing Requirements for otel_sdk"
mkdir -p ./build
python3 -m pip install -r ./otel_sdk/requirements.txt -t ./build/python
python3 -m pip install -r ./otel_sdk/requirements-nodeps.txt -t ./build/tmp --no-deps
cp -r ./build/tmp/* ./build/python/
rm -rf ./build/tmp

log "Copying otel-instrument, otel-handler, otel_wrapper, pip.conf, constraints.txt"
cp ./otel_sdk/otel-instrument ./build/otel-instrument
chmod 755 ./build/otel-instrument
cp ./otel_sdk/otel-instrument ./build/otel-handler
chmod 755 ./build/otel-handler
cp ./otel_sdk/otel_wrapper.py ./build/python/
cp ./otel_sdk/pip.conf ./build/python/
cp ./otel_sdk/constraints.txt ./build/python/

log "Applying FIPS compatibility patches"
patch_protobuf_fips_hash_usage ./build/python

log "Cleaning up boto and urllib3"
rm -rf ./build/python/boto*
rm -rf ./build/python/urllib3*

popd > /dev/null

log "Zipping up the layer"
pushd ./python/sample-apps/otel/build
zip -r layer.zip ./*
popd > /dev/null
