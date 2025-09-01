#!/bin/sh

set -e

SCRIPT_DIR=$(dirname $(readlink -f "$0"))
MAIN_DIR="$(dirname $SCRIPT_DIR)"
WORK_DIR=$MAIN_DIR/docker-tmp
DOCKERFILE_PYTHON=$WORK_DIR/Dockerfile-python
DOCKERFILE_SSL=$WORK_DIR/Dockerfile-ssl
DOCKER_REGISTRY=gitlab2.simplito.com:5050/teamserverdev/privmx-server-ee
NODE_IMAGE_VERSION=22.11.0-bullseye-slim
DOCKER_PYTHON_IMAGE=${DOCKER_REGISTRY}/node-python3:${NODE_IMAGE_VERSION}
DOCKER_SSL_IMAGE=${DOCKER_REGISTRY}/node-ssl:${NODE_IMAGE_VERSION}

rm -rf $WORK_DIR
mkdir -p $WORK_DIR

if docker pull "$DOCKER_PYTHON_IMAGE"; then
    echo "Image $DOCKER_PYTHON_IMAGE already built"
else
    tee $DOCKERFILE_PYTHON > /dev/null << END
FROM node:${NODE_IMAGE_VERSION}
RUN apt update && apt install -y python3 build-essential
END

    cat $DOCKERFILE_PYTHON
    docker build --progress=plain -t $DOCKER_PYTHON_IMAGE -f $DOCKERFILE_PYTHON $WORK_DIR
    docker push $DOCKER_PYTHON_IMAGE
fi

if docker pull "$DOCKER_SSL_IMAGE"; then
    echo "Image $DOCKER_SSL_IMAGE already built"
else
    tee $DOCKERFILE_SSL > /dev/null << END
FROM node:${NODE_IMAGE_VERSION}
RUN apt-get update && apt-get install -y libssl1.1
END

    cat $DOCKERFILE_SSL
    docker build --progress=plain -t $DOCKER_SSL_IMAGE -f $DOCKERFILE_SSL $WORK_DIR
    docker push $DOCKER_SSL_IMAGE
fi

rm -rf $WORK_DIR
