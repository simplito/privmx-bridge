#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
MAIN_DIR="$(dirname $SCRIPT_DIR)"

docker build --progress=plain --build-arg E2E_TESTS=no  -t privmx-bridge $MAIN_DIR
