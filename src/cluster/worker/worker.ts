/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import * as http from "http";
import * as https from "https";
import { WorkerRegistry } from "./WorkerRegistry";
import { loadConfig } from "../common/ConfigUtils";
import { App } from "../../service/app/App";
import * as pki from "privmx-pki2";
import { PluginsLoader } from "../../service/plugin/PluginsLoader";
import * as WebSocket from "ws";
import { WebSocketEx } from "../../CommonTypes";
import * as PrivMXNative from "../../utils/crypto/PrivMXNative";
import * as terminus from "@godaddy/terminus";
import * as fs from "fs";
import { ConsoleAppender, LoggerFactory } from "../../service/log/LoggerFactory";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

const loggerFactory = new LoggerFactory("MAIN", new ConsoleAppender());
const logger = loggerFactory.get("WORKER");

PrivMXNative.init(loggerFactory.get("PrivMXNative"));

// preload all libs
if (App) {
    const key = pki.common.keystore.KeyStore.deserialize(pki.common.keystore.Packet.unarmor(
`-----BEGIN PGP PRIVATE KEY BLOCK-----

/AEBxXQEYffsphMFK4EEAAoCAwQEN2UUiPm81kuSGPvxydyiFbD28Rp3it+iXgrm
9eviZ3Df5BjFr613XkI/7uyRzA7NuYaWrfvA9tiTdAUT/SQ5AAD/epYsBS5QBTXE
wmiyb5pU4htC1rhvr8NK73JP9B2xbO0QuM0UZ2FnYWdhLmxvY2FsaG9zdC5jb23C
YQQTEwgACQIbAwUCYffspgAKCRBwXjxN7uRftHByAQD3UIvYeWfBK35d753OwrGt
yahosJa8mCzlK33gVB0rsgEAmqpbpDXjcmWEiaEZmWdfXfDcifCPE2v9p3Be6ayV
nF4=
=OBKZ
-----END PGP PRIVATE KEY BLOCK-----`));
    key.getPrimaryUserId();
}

export function startWorker() {
    const worker = cluster.worker;
    if (!worker) {
        throw new Error("Cannot run WorkerThread outside of worker");
    }
    initWorker(worker).catch(e => logger.error("Error during initializing", e));
}

async function initWorker(worker: Cluster.Worker) {
    const registry = new WorkerRegistry(loggerFactory);
    registry.registerWorker(worker);
    PluginsLoader.loadForWorker(registry);
    registry.getTypesValidator(); // Preload validators to speed up first request
    const ipcMessageProcessor = registry.getIpcMessageProcessor();
    worker.on("message", message => {
        void ipcMessageProcessor.processMessage(message, "master", worker);
    });
    await registry.initIpc();
    const config = registry.registerConfig(loadConfig(false, registry.getWorkerCallbacks()));
    LoggerFactory.ESCAPE_NEW_LINE = config.loggerEscapeNewLine;
    await registry.createMongoClient(config.db.mongo.url);
    await registry.getWorkerCallbacks().trigger("initDb", []);
    registry.registerIpcServices();
    const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        req.on("error", e => logger.error("Request Error", e));
        res.on("error", e => logger.error("Response Error", e));
        req.socket.on("error", e => logger.error("Request Socket Error", e));
        registry.getHttpHandler().onRequest(req, res);
    };
    
    if (config.server.mode.type === "single" && worker.id === 1) {
        logger.out("First worker run init at startup...");
        await registry.getHttpHandler().createHostContext();
    }
    await registry.getWorkerCallbacks().trigger("initWorker", []);
    
    const httpServer = registry.registerHttpServer(http.createServer(onRequest));
    setupServer(registry, httpServer);
    httpServer.listen(config.server.port, config.server.hostname, () => {
        logger.out(`Worker starterd, listen on http://${config.server.hostname}:${config.server.port}`);
    });
    
    if (config.server.ssl.enabled) {
        const httpsServer = registry.registerHttpsServer(https.createServer({
            key: fs.readFileSync(config.server.ssl.privKeyPath, "utf8"),
            cert: fs.readFileSync(config.server.ssl.certificatePath, "utf8")
        }, onRequest));
        setupServer(registry, httpsServer);
        httpsServer.listen(config.server.ssl.port, config.server.hostname, () => {
            logger.out(`Worker starterd, listen on https://${config.server.hostname}:${config.server.ssl.port}`);
        });
    }
    registry.getWorkerCallbacks().triggerSync("workerLoaded", []);
}

function setupServer(registry: WorkerRegistry, server: http.Server|https.Server) {
    setUpTerminus(registry, server);
    server.on("error", (e) => {
        logger.error("Server Error", e);
    });
    
    const wss = new WebSocket.Server({server: server});
    registry.getWebSocketInnerManager().registerServer(wss);
    wss.on("connection", (ws: WebSocketEx, req) => {
        registry.getHttpHandler().onWebSocketConnection(ws, req);
    });
    registry.getJobManager().createJob({
        name: "wsAliveRefresher",
        interval: 10 * 1000,
        func: () => {
            wss.clients.forEach((ws: WebSocket) => {
                if (!(<WebSocketEx>ws).ex.isAlive) {
                    ws.terminate();
                    return;
                }
                (<WebSocketEx>ws).ex.isAlive = false;
                ws.ping();
            });
        },
        runOnCreate: false
    });
    return server;
}

function setUpTerminus(registry: WorkerRegistry, server: http.Server|https.Server) {
    const shutdownTimeout = registry.getConfig().server.shutdownTimeout;
    terminus.createTerminus(server, {
        signals: ["SIGINT", "SIGTERM"],
        timeout: shutdownTimeout,
        healthChecks: {
            "/healthcheck": async () => {
                return;
            }
        },
        beforeShutdown: async () => {
            logger.out(`Shuting down - waiting max ${shutdownTimeout}ms to finish requests...`);
        },
        onSignal: async () => {
            await tryClose(registry, server);
        },
        onShutdown: async () => {
            logger.out("Server gracefully turned off!");
        }
    });
}

async function tryClose(registry: WorkerRegistry, server: http.Server|https.Server) {
    logger.out("Flushing server stats...");
    await registry.getServerStatsWorkerService().flush();
    logger.out("Closing plugins...");
    await registry.getWorkerCallbacks().trigger("closeWorker", []);
    logger.out("Closing db connections...");
    registry.getJobManager().stopAll();
    try {
        await registry.getMongoClient().close();
    }
    catch {
        logger.error("Error during closing mongo connection");
    }
    await registry.getWorkerCallbacks().trigger("closeDb", []);
    server.close();
}
