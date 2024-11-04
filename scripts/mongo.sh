#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
MAIN_DIR="$(dirname $SCRIPT_DIR)"
ENV_FILE=$SCRIPT_DIR/.env

MONGO_RS_NAME=rs0
MONGO_HOST_NAME=localhost
MONGO_PORT=27017
MONGO_VOLUME_DIR=$MAIN_DIR/volumes/mongo/data/db

if [ -f $ENV_FILE ]; then
    source $ENV_FILE
fi

docker run \
    --rm \
    -it \
    -p $MONGO_PORT:$MONGO_PORT \
    --health-cmd "echo 'try { rs.status() } catch (err) { rs.initiate({_id:\"$MONGO_RS_NAME\",members:[{_id:0,host:\"$MONGO_HOST_NAME:$MONGO_PORT\"}]}) }' | mongosh --port $MONGO_PORT --quiet" \
    --health-start-period 10s \
    --health-start-interval 1s \
    -v "$MONGO_VOLUME_DIR:/data/db" \
    mongo:7.0 \
    --replSet $MONGO_RS_NAME --bind_ip_all --port $MONGO_PORT
