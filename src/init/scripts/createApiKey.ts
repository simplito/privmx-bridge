/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import { Config, loadConfig } from "../../cluster/common/ConfigUtils";
import { MongoDbManager } from "../../db/mongo/MongoDbManager";
import { ConsoleAppender, LoggerFactory } from "../../service/log/LoggerFactory";
import * as mongodb from "mongodb";
import { MetricService } from "../../service/misc/MetricService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as types from "../../types";
import * as fs from "fs";
import { ConfigLoader, InitConfigValues } from "../../service/config/ConfigLoader";
import { Callbacks } from "../../service/event/Callbacks";
import { JobService } from "../../service/job/JobService";
import * as util from "util";
import { ConfigService } from "../../service/config/ConfigService";

const loggerFactory = new LoggerFactory("MAIN", new ConsoleAppender());
const logger = loggerFactory.get("MASTER");

async function go() {
    const config = loadConfig(false);
    if (config.server.mode.type !== "single") {
        throw new Error("Only single mode is supported");
    }
    const {fullConfig} = loadConfigFromFile(config.server.mode.configPath, config);
    const mongoClient = await mongodb.MongoClient.connect(config.db.mongo.url, {minPoolSize: 5, maxPoolSize: 5});
    const mongoDbManager = new MongoDbManager(
        mongoClient,
        loggerFactory.get(MongoDbManager),
        new MetricService(),
    );
    mongoDbManager.init(fullConfig.db.mongo.dbName);
    const repositoryFactory = new RepositoryFactory(mongoDbManager, null as unknown as ConfigService);
    const apiUserRepository = repositoryFactory.createApiUserRepository();
    const user = await apiUserRepository.create();
    const apiKeyRepository = repositoryFactory.createApiKeyRepository();
    const apiKey = await apiKeyRepository.create(user.id, "MainKey" as types.auth.ApiKeyName, [
        "context", "apiKey", "solution", "solution:*", "inbox", "store", "thread", "stream",
    ] as types.auth.Scope[], true, undefined);
    console.log(`API_KEY_ID=${apiKey.id}`);
    console.log(`API_KEY_SECRET=${apiKey.secret}`);
    await mongoDbManager.close();
}

function loadConfigFromFile(filePath: string, baseConfig: Config) {
    const config = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as InitConfigValues : {};
    const fullConfig = new ConfigLoader(new Callbacks(new JobService(logger)), baseConfig).getFileLoader(filePath)();
    return {config, fullConfig};
}

function consoleErr(str: string) {
    process.stderr.write(str + "\n");
}

go().catch(e => {
    consoleErr("Error:" + util.format(e));
    process.exit(1);
});
