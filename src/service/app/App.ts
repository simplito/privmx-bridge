/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IOC } from "../ioc/IOC";
import { LoggerFactory, Logger, ConsoleAppender } from "../log/LoggerFactory";
import { MongoBinaryRepositoryFactory } from "../../db/mongo/MongoBinaryRepositoryFactory";
import { ECUtils } from "../../utils/crypto/ECUtils";
import * as pki from "privmx-pki2";
import { ConfigChanger } from "../config/ConfigLoader";
import { MongoDbManager } from "../../db/mongo/MongoDbManager";
import { PromiseUtils } from "../../utils/PromiseUtils";
import { MigrationManager } from "../../db/migration/MigrationManager";
import { Crypto } from "../../utils/crypto/Crypto";
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { InitInfo, StateValue } from "../config/ConfigRepository";
import { Hex } from "../../utils/Hex";
import { WorkerRegistry } from "../../cluster/worker/WorkerRegistry";
import { PluginsLoader } from "../plugin/PluginsLoader";
import { loadConfigFromFile } from "../../cluster/common/ConfigUtils";

export class App {
    
    private static SERVER_DATA_ID_SETTINGS_KEY = "serverDataId";
    private jobInfo?: {dbName: string; lastJobRun: types.core.Timestamp;};
    
    constructor(
        public ioc: IOC,
        private logger: Logger,
    ) {
        this.ioc.getLoggerFactory().setLevel("ConfigLoader", Logger.DEBUG);
        this.ioc.registerApp(this);
    }
    
    setConfigLoadingByFile(configPath: string) {
        this.ioc.registerConfigLoaderFunc(this.ioc.getConfigLoader().getFileLoader(configPath));
    }
    
    setConfigLoadingByChanger(configChanger: ConfigChanger, finisher: ConfigChanger) {
        this.ioc.registerConfigLoaderFunc(this.ioc.getConfigLoader().getConfigChangerLoader(configChanger, finisher));
    }
    
    loadConfig() {
        const configService = this.ioc.getConfigService();
        configService.readConfigFile();
    }
    
    async loadKeystore() {
        const configService = this.ioc.getConfigService();
        const domain = configService.values.domain;
        const pkiFactory = this.ioc.getPkiFactory();
        let pem = await pkiFactory.getServerKeystoreFromSettings();
        if (pem == null) {
            pem = ECUtils.generateKeystore(domain);
            await pkiFactory.setServerKeystoreInSettings(pem);
        }
        const keystore = (() => {
            const newKeystore = pki.common.keystore.KeyStore.deserialize(pki.common.keystore.Packet.unarmor(pem));
            if (newKeystore.getPrimaryUserId() != domain) {
                throw new Error("Keystore domain (" + newKeystore.getPrimaryUserId() + ") does not match to config (" + domain + ")");
            }
            return newKeystore;
        })();
        this.ioc.getPkiFactory().registerKeystore(keystore);
        return {pem, keystore};
    }
    
    private async initMongoDb(mongoDbManager: MongoDbManager, tryManyTimes: boolean) {
        const configService = this.ioc.getConfigService();
        const mongoConfig = configService.values.db.mongo;
        let i = 0;
        const sleeps = [2, 3, 5, 10, 30, 60];
        while (true) {
            try {
                await mongoDbManager.init(mongoConfig.url, mongoConfig.dbName);
                // this.logger.notice("Connected to mongodb");
                return;
            }
            catch (e) {
                if (tryManyTimes) {
                    if (i < sleeps.length) {
                        const sleep = sleeps[i];
                        this.logger.error("Cannot connect to mongodb, attempt " + (i + 1) + "/" + (sleeps.length + 1) + " failed, sleep for " + sleep + " seconds", e);
                        i++;
                        await PromiseUtils.wait(sleep * 1000);
                    }
                    else {
                        this.logger.error("Cannot connect to mongodb, attempt " + (i + 1) + "/" + (sleeps.length + 1) + " failed, quitting", e);
                        throw new Error("Cannot connect to mongodb");
                    }
                }
                else {
                    throw e;
                }
            }
        }
    }
    
    async initDb(options: {tryManyTimes?: boolean, /* loadSessionsAndTickets?: boolean */}) {
        const mongoDbManager = this.ioc.getMongoDbManager();
        await this.initMongoDb(mongoDbManager, !!options.tryManyTimes);
        this.ioc.registerBinaryRepositoryFactory("mongo", dbName => new MongoBinaryRepositoryFactory(mongoDbManager, dbName));
    }
    
    async tryClose() {
        this.logger.out("Closing db connections...");
        this.ioc.getJobManager().stopAll();
        // try {
        //     await this.ioc.getMongoDbManager().close();
        // }
        // catch (e) {
        //     this.logger.error("Error during closing mongo connection");
        // }
        // await this.ioc.workerRegistry.getWorkerCallbacks().trigger("closeDb", []);
    }
    
    prepare() {
        this.ioc.loadPlugins();
    }
    
    // Runners
    
    static initWithConfigFile(filePath: string, ioc?: IOC) {
        const loggerFactory = new LoggerFactory("<main>", new ConsoleAppender());
        const workerRegistry = new WorkerRegistry(loggerFactory);
        PluginsLoader.loadForWorker(workerRegistry);
        workerRegistry.registerConfig(loadConfigFromFile(filePath, false, workerRegistry.getWorkerCallbacks()));
        const app = new App(ioc || new IOC("<main>" as types.core.Host, workerRegistry, loggerFactory), loggerFactory.get(App));
        app.setConfigLoadingByFile(filePath);
        return App.prepare(app);
    }
    
    static initWithConfigChanger(ioc: IOC, configChanger: ConfigChanger, finisher: ConfigChanger) {
        const app = new App(ioc, ioc.getLoggerFactory().get(App));
        app.setConfigLoadingByChanger(configChanger, finisher);
        return App.prepare(app);
    }
    
    static initWithIocAndConfigFile(ioc: IOC, filePath: string) {
        const app = new App(ioc, ioc.getLoggerFactory().get(App));
        app.setConfigLoadingByFile(filePath);
        return App.prepare(app);
    }
    
    private static prepare(app: App) {
        app.prepare();
        app.loadConfig();
        return app;
    }
    
    // Init helpers
    
    async init4(info: InitInfo) {
        await this.initDb({});
        await this.checkState(info, true);
        const privmxExpressApp = this.ioc.getPrivmxExpressApp();
        privmxExpressApp.registerRoutes();
    }
    
    async checkState(info: InitInfo, checkAdminGenerated: boolean) {
        if (!this.stateIsValid(info.state)) {
            this.logger.out("[CheckState] State need refresh...", this.ioc.getConfigService().values.db.mongo.dbName);
            const dbManger = this.ioc.getMongoDbManager();
            if (info.state.dbVersion == "") {
                await dbManger.ensureLockCollection();
                await dbManger.tryCreateCollection("settings", []);
            }
            await dbManger.withTransactionAndLock("SERVER_INIT", async () => {
                const configRepository = this.ioc.workerRegistry.getConfigRepository();
                let newState = (await configRepository.getInfo(info.dbName)).state;
                if (!newState.keystoreGenerated) {
                    this.logger.out("[CheckState] Keystore generating");
                    await this.loadKeystore();
                    newState = {...newState, keystoreGenerated: true};
                    await configRepository.setState(info.dbName, newState);
                }
                if (newState.dbVersion !== MigrationManager.getDbVersion()) {
                    this.logger.out("[CheckState] Need to make migration");
                    const logger = this.ioc.getLoggerFactory().get("MigrationManager");
                    logger.setLevel(Logger.DEBUG);
                    const migrationManager = new MigrationManager(this.ioc.getDbManager(), this.ioc, logger);
                    await migrationManager.go();
                    newState = {...newState, dbVersion: MigrationManager.getDbVersion()};
                    await configRepository.setState(info.dbName, newState);
                }
                if (!newState.ticketKey) {
                    this.logger.out("[CheckState] Ticket key generating");
                    const ticketKey = Crypto.randomBytes(32);
                    this.ioc.getTicketKeyHolder().setKey(ticketKey);
                    newState = {...newState, ticketKey: Hex.from(ticketKey)};
                    await configRepository.setState(info.dbName, newState);
                }
                else {
                    this.ioc.getTicketKeyHolder().setKey(Hex.toBuf(newState.ticketKey));
                }
                if (!newState.dataIdGenerated) {
                    this.logger.out("[CheckState] Data id generating");
                    await this.checkServerDataId();
                    newState = {...newState, dataIdGenerated: true};
                    await configRepository.setState(info.dbName, newState);
                }
                if (checkAdminGenerated && !newState.adminGenerated) {
                    this.logger.out("[CheckState] Admin checking");
                    await this.checkAdmin();
                    newState = {...newState, adminGenerated: true};
                    await configRepository.setState(info.dbName, newState);
                }
                if (!newState.cachedPkiAssigned) {
                    this.logger.out("[CheckState] Update cached pki entry");
                    newState = {...newState, cachedPkiAssigned: true};
                    await configRepository.setState(info.dbName, newState);
                }
            });
        }
        else {
            this.ioc.getTicketKeyHolder().setKey(Hex.toBuf(info.state.ticketKey));
        }
        this.jobInfo = {dbName: info.dbName, lastJobRun: info.lastJobRun};
        void this.tryRunJobs();
    }
    
    private stateIsValid(state: StateValue) {
        return state.dbVersion === MigrationManager.getDbVersion() && state.keystoreGenerated && state.dataIdGenerated && state.adminGenerated && state.cachedPkiAssigned && state.ticketKey;
    }
    
    async tryRunJobs() {
        const jobInfo = this.getJobInfoIfThereIsNeedToRunJobs();
        if (!jobInfo) {
            return;
        }
        try {
            const configRepository = this.ioc.workerRegistry.getConfigRepository();
            const res = await configRepository.updateLastJobRun(jobInfo.dbName, jobInfo.lastJobRun);
            if (!res.updated) {
                return;
            }
            jobInfo.lastJobRun = res.date;
            this.logger.out("Running jobs");
            const jobManager = this.ioc.getJobManager();
            void jobManager.run({name: "nonceCleaner", func: () => this.ioc.getNonceService().cleanNonceDb()});
            void jobManager.run({name: "clearSessions", func: () => this.ioc.getSessionCleaner().clearOldSessions(undefined)});
            void jobManager.run({name: "clearRequests", func: () => this.ioc.getRequestService().clearExpired()});
            void jobManager.run({name: "clearOldStats", func: () => this.ioc.getServerStatsService().clearOld()});
        }
        catch (e) {
            this.logger.error("Error during runnning jobs", e);
        }
    }
    
    private getJobInfoIfThereIsNeedToRunJobs() {
        return this.jobInfo && DateUtils.timeElapsed(this.jobInfo.lastJobRun, DateUtils.minutes(10)) ? this.jobInfo : null;
    }
    
    private async checkAdmin() {
        // TODO
    }
    
    private async checkServerDataId() {
        let serverDataId = await this.getServerDataId();
        if (!serverDataId) {
            serverDataId = Crypto.randomBytes(16).toString("hex");
            await this.setServerDataId(serverDataId);
        }
    }
    
    private getServerDataId() {
        return this.ioc.getSettingsService().getString(App.SERVER_DATA_ID_SETTINGS_KEY);
    }
    
    private setServerDataId(serverDataId: string) {
        return this.ioc.getSettingsService().setString(App.SERVER_DATA_ID_SETTINGS_KEY, serverDataId);
    }
}
