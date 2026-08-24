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
import { LoggerFactory } from "../../service/log/LoggerFactory";
import * as mongodb from "mongodb";
import { MetricService } from "../../service/misc/MetricService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ConfigService } from "../../service/config/ConfigService";
import { ConfigLoader, InitConfigValues } from "../../service/config/ConfigLoader";
import { Callbacks } from "../../service/event/Callbacks";
import { JobService } from "../../service/job/JobService";
import { TreeValidator } from "../../service/cloud/keytree/TreeValidator";
import * as fs from "fs";
import * as util from "util";

/**
 * Checks every tree-backed group against the rules a write has to satisfy.
 *
 * A removal submitted as a transition is checked against the stored state rather than replacing it, so the bridge
 * no longer re-validates the whole tree on every write. That is sound while every write goes through a validator —
 * and it stops being sound the moment something writes tree state without one: a migration, a repair script, a
 * bug. This is what catches that, and it is why it exists rather than being a nice-to-have.
 *
 * Read-only. Run it after any direct write to the group collections, and on a schedule if you want the guarantee
 * continuously.
 */

const loggerFactory = new LoggerFactory("MAIN");
const logger = loggerFactory.createLogger("MASTER");

async function go() {
    const config = loadConfig(false);
    if (config.server.mode.type !== "single") {
        throw new Error("Only single mode is supported");
    }
    const {fullConfig} = loadConfigFromFile(config.server.mode.configPath, config);
    const mongoClient = await mongodb.MongoClient.connect(config.db.mongo.url, {minPoolSize: 1, maxPoolSize: 5});
    const mongoDbManager = new MongoDbManager(
        mongoClient,
        loggerFactory.createLogger(MongoDbManager),
        new MetricService(),
        new Map<string, unknown>(),
    );
    mongoDbManager.init(fullConfig.db.mongo.dbName);
    const repositoryFactory = new RepositoryFactory(mongoDbManager, null as unknown as ConfigService);
    const groupRepository = repositoryFactory.createGroupRepository();
    
    let checked = 0;
    let flat = 0;
    let broken = 0;
    const groups = mongoDbManager.getCollectionByName("group");
    for await (const doc of groups.find({}, {projection: {_id: 1}})) {
        const group = await groupRepository.get(doc._id as never);
        if (!group) {
            continue;
        }
        if (group.numLeaves === undefined) {
            flat++;
            continue;
        }
        checked++;
        const tree = await groupRepository.getTree(group);
        if (!tree) {
            broken++;
            console.log(`${group.id}: tree geometry on the document but no nodes or edges stored`);
            continue;
        }
        const problems = TreeValidator.validateState(tree, {users: group.users, managers: group.managers}, group.keyVersion ?? 0);
        if (problems.length > 0) {
            broken++;
            console.log(`${group.id}: ${problems.length} problem(s)`);
            for (const problem of problems.slice(0, 10)) {
                console.log(`   ${JSON.stringify(problem)}`);
            }
            if (problems.length > 10) {
                console.log(`   … and ${problems.length - 10} more`);
            }
        }
    }
    console.log(`checked ${checked} tree-backed group(s), skipped ${flat} flat one(s), ${broken} broken`);
    await mongoDbManager.close();
    if (broken > 0) {
        process.exit(2);
    }
}

function loadConfigFromFile(filePath: string, baseConfig: Config) {
    const config = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as InitConfigValues : {};
    const fullConfig = new ConfigLoader(new Callbacks(new JobService(logger)), baseConfig).getFileLoader(filePath)();
    return {config, fullConfig};
}

go().catch(e => {
    process.stderr.write("Error:" + util.format(e) + "\n");
    process.exit(1);
});
