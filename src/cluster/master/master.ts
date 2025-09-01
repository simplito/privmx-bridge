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
import { ConsoleAppender, LoggerFactory } from "../../service/log/LoggerFactory";
import { MongoDebug } from "../../db/mongo/MongoDebug";
import { DateUtils } from "../../utils/DateUtils";
import { PluginsLoader } from "../../service/plugin/PluginsLoader";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

const loggerFactory = new LoggerFactory("MAIN", new ConsoleAppender());
const logger = loggerFactory.get("MASTER");

export function startMaster() {
    if (!cluster.isPrimary) {
        throw new Error("Cannot run MasterThread outside of master");
    }
    initMaster().catch(e => {
        logger.error("Error during initializing", e);
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
    cluster.on("message", (worker, message) => {
        void ipcMessageProcessor.processMessage(message, `worker ${worker.id}`, worker);
    });
    const config = masterRegistry.registerConfig(loadConfig(loggerFactory.get("ConfigLoader"), masterRegistry.getCallbacks()));
    LoggerFactory.ESCAPE_NEW_LINE = config.loggerEscapeNewLine;
    masterRegistry.registerMongoClient(MongoDebug.decorateClient(await mongodb.MongoClient.connect(config.db.mongo.url, {minPoolSize: 5, maxPoolSize: 5})));
    masterRegistry.registerIpcServices();
    
    logger.out(`Master thread started - spawning ${config.server.workers} workers`);
    const workersHolder = masterRegistry.getWorkersHolder();
    for (let i = 0; i < config.server.workers; i++) {
        workersHolder.createWorker();
    }
    startJobs(masterRegistry);
    async function onExitSignal() {
        workersHolder.killWorkers();
        // Wait for all workers to exit
        while (true) {
            if (!workersHolder.hasWorkers()) {
                logger.out("All workers are dead, so bye!");
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
    const aggregatedNotificationsService = registry.getAggregatedNotificationsService();
    const websocketCommunicationManager = registry.getWebsocketCommunicationManager();
    jobService.addPeriodicJob(() => ipRateLimiter.addCreditsAndRemoveInactive(), config.apiRateLimit.addonInterval, "creditRefresh");
    jobService.addPeriodicJob(async () => nonceMap.deleteExpired(), DateUtils.minutes(5), "nonceCacheRemoval");
    jobService.addPeriodicJob(async () => aggregatedNotificationsService.flush((model) => websocketCommunicationManager.sendWebsocketNotification(model)), DateUtils.seconds(1), "aggregatedEventsFlush");
}
