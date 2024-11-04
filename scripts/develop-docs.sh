#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
MAIN_DIR="$(dirname $SCRIPT_DIR)"

docker run --rm --name slate -p 4567:4567 -v $MAIN_DIR/slatedocs:/srv/slate/source slatedocs/slate serve
