#!/bin/bash

set -euo pipefail

FILE_SIZE=$(stat -c "%s" "$FILE_PATH")

if [[ $FILE_SIZE -gt $MAX_SIZE ]]; then
    echo "File is larger than expected ($MAX_SIZE bytes)"
    exit 1
fi
