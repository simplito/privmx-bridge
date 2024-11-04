#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
MAIN_DIR="$(dirname $SCRIPT_DIR)"
ENV_FILE=$SCRIPT_DIR/.env

NODE_NETWORK=host

if [ -f $ENV_FILE ]; then
    source $ENV_FILE
fi

docker run \
    --rm \
    -it \
    --network $NODE_NETWORK \
    -v "$MAIN_DIR:/app" \
    -w /app \
    node:22-bullseye-slim \
    bash
