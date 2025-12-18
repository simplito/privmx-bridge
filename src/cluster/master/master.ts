/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import { loadConfig } from "../common/ConfigUtils";
import { MasterRegistry } from "./MasterRegistry";
import * as mongodb from "mongodb";
import { VersionDetector } from "../../service/config/VersionDetector";
import { PromiseUtils } from "../../utils/PromiseUtils";
import { LoggerFactory } from "../../service/log/LoggerFactory";
import { MongoDebug } from "../../db/mongo/MongoDebug";
import { DateUtils } from "../../utils/DateUtils";
import { PluginsLoader } from "../../service/plugin/PluginsLoader";
import { Utils } from "../../utils/Utils";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

const loggerFactory = new LoggerFactory(`${Utils.getThisWorkerId()}`);
const logger = loggerFactory.createLogger("INIT");

export function startMaster() {
    if (!cluster.isPrimary) {
        throw new Error("Cannot run MasterThread outside of master");
    }
    initMaster().catch(e => {
        logger.error(e, "Error during initializing");
        process.exit(1);
    });
}

async function initMaster() {
    const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
    if (nodeVersion != 22) {
        logger.error("Your node version (" + process.versions.node + ") is invalid, you need 22.x.x");
        process.exit(1);
    }
    logger.out("PrivMX Server " + VersionDetector.detectServerVersion() + " (node: " + process.versions.node + ")");
    const masterRegistry = new MasterRegistry(loggerFactory);
    PluginsLoader.loadForMaster(masterRegistry);
    const ipcMessageProcessor = masterRegistry.getIpcMessageProcessor();
    cluster.setupPrimary();
    cluster.setupPrimary();
    cluster.on("message", (worker, message) => {
        void ipcMessageProcessor.processMessage(message, `worker ${worker.id}`, worker);
    });
    const config = masterRegistry.registerConfig(loadConfig(loggerFactory.createLogger("ConfigLoader"), masterRegistry.getCallbacks()));
    masterRegistry.registerMongoClient(MongoDebug.decorateClient(await mongodb.MongoClient.connect(config.db.mongo.url, {minPoolSize: 32, maxPoolSize: 64})));
    masterRegistry.registerIpcServices();
    const broker = masterRegistry.getBroker();
    if (broker !== null) {
        await broker.start();
    }
    else {
        logger.out("Internal broker disabled");
    }
    logger.out(`Master thread started - spawning ${config.server.workers} workers`);
    const workersHolder = masterRegistry.getWorkersHolder();
    for (let i = 0; i < config.server.workers; i++) {
        workersHolder.createWorker();
    }
    startJobs(masterRegistry);
    async function onExitSignal() {
        workersHolder.killWorkers();
        if (broker !== null) {
            broker.stop();
        }
        while (true) {
            if (!workersHolder.hasWorkers()) {
                logger.out("All workers are dead, so bye!");
                loggerFactory.flushLogs();
                process.exit();
            }
            await PromiseUtils.wait(100);
        }
    }
    process.on("SIGINT", () => void onExitSignal());
    process.on("SIGTERM", () => void onExitSignal());
}

function startJobs(registry: MasterRegistry) {
    const jobService = registry.getJobService();
    const ipRateLimiter = registry.getIpRateLimiter();
    const nonceMap = registry.getNonceMap();
    const config = registry.getConfig();
    jobService.addPeriodicJob(() => ipRateLimiter.addCreditsAndRemoveInactive(), config.apiRateLimit.addonInterval, "creditRefresh");
    jobService.addPeriodicJob(async () => nonceMap.deleteExpired(), DateUtils.minutes(5), "nonceCacheRemoval");
}
