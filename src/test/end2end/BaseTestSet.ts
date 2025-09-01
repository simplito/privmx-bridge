/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */
/* eslint-disable max-classes-per-file */
import { ChildProcess, spawn } from "child_process";
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import { MongoClient } from "mongodb";
import * as path from "path";
import * as fs from "fs";
import * as mongodb from "mongodb";
import { PromiseUtils } from "../../utils/PromiseUtils";
import { Deferred } from "../../CommonTypes";
import { MongoDbManager } from "../../db/mongo/MongoDbManager";
import { MetricService } from "../../service/misc/MetricService";
import { ConsoleAppender, Logger } from "../../service/log/LoggerFactory";
import { HttpClient2 } from "../../utils/HttpClient2";
import { ConfigLoader } from "../../service/config/ConfigLoader";
import { ContextApiClient } from "../../api/main/context/ContextApiClient";
import { ThreadApiClient } from "../../api/main/thread/ThreadApiClient";
import { StoreApiClient } from "../../api/main/store/StoreApiClient";
import { InboxApiClient } from "../../api/main/inbox/InboxApiClient";
import { RequestApiClient } from "../../api/main/request/RequestApiClient";
import { UserApiClient } from "../../api/main/user/UserApiClient";
import { StreamApiClient } from "../../api/main/stream/StreamApiClient";
import * as PrivmxRpc from "@simplito/privmx-minimal-js";
import { ErrorCode, ERROR_CODES } from "../../api/AppException";
import * as assert from "assert";
import { ManagementContextApiClient } from "../../api/plain/context/ManagementContextApiClient";
import { ManagementStoreApiClient } from "../../api/plain/store/ManagementStoreApiClient";
import { ManagementThreadApiClient } from "../../api/plain/thread/ManagementThreadApiClient";
import { ManagementInboxApiClient } from "../../api/plain/inbox/ManagementInboxApiClient";
import { ManagerApiClient } from "../../api/plain/manager/ManagerApiClient";
import { ManagementSolutionApiClient } from "../../api/plain/solution/ManagementSolutionApiClient";
import { JsonRpcClient, JsonRpcException } from "../../utils/JsonRpcClient";
import { ManagementStreamApiClient } from "../../api/plain/stream/ManagementStreamApiClient";
import { testData } from "../datasets/testData";
import * as types from "../../types";
import { KvdbApiClient } from "../../api/main/kvdb/KvdbApiClient";
import { ManagementKvdbApiClient } from "../../api/plain/kvdb/ManagementKvdbApiClient";
import { Crypto } from "../../utils/crypto/Crypto";

interface Collection {
    name: string;
    content: mongodb.Document[];
}

interface TestOptions {
    dataSet?: string;
    config?: object,
}

export function Test(options?: TestOptions) {
    return (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => {
        if (target.__exportedTests == null) {
            target.__exportedTests = [];
        }
        options =  (options) ? options : {} as TestOptions;
        target.__exportedTests.push({method: propertyKey, options});
    };
}

export async function executeWithTimeout<T>(func: () => Promise<T>, timeout: types.core.Timespan): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeout}ms`));
        }, timeout);
        func()
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error: Error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

export async function shouldThrowErrorWithCode(func: () => Promise<unknown>, errorCode: ErrorCode) {
    try {
        await func();
        assert(false, "Executed function did not throw specified errorCode");
    }
    catch (e) {
        const error = JsonRpcException.getJsonRpcError(e);
        assert(error !== null, "Error is not JsonRpcError");
        assert(ERROR_CODES[errorCode].code === error.code, `Error code does not match, expected ${ERROR_CODES[errorCode].code} (${errorCode}), given ${error.code}`);
    }
}

export async function shouldThrowErrorWithCode2(func: () => Promise<unknown>, errorCode: ErrorCode) {
    try {
        await func();
        assert(false, "Executed function did not throw specified errorCode");
    }
    catch (e) {
        assert(isRpcError(e), "Error is not JsonRpcError");
        assert(ERROR_CODES[errorCode].code === e.data.error.code, `Error code does not match, expected ${ERROR_CODES[errorCode].code} (${errorCode}), given ${e.data.error.code}`);
    }
}

export function isRpcError(e: unknown): e is {data: {error: {code: number, data: string}}, msg: string} {
    return typeof(e) === "object" && e !== null && "data" in e && typeof(e.data) === "object" && e.data !== null && "error" in e.data && typeof(e.data.error) === "object" && e.data.error !== null && "code" in e.data.error && typeof(e.data.error.code) === "number";
}

export function verifyResponseFor(apiMethodName: string, response: unknown, requiredFields: string[]) {
    assert(!!response && typeof(response) === "object" && requiredFields.every(x => x in response), `${apiMethodName}() invalid response ${JSON.stringify(response, null, 2)}`);
}

export function verifyResponseIsOK(apiMethodName: string, response: unknown) {
    assert(response === "OK", `${apiMethodName}() invalid response${JSON.stringify(response, null, 2)}`);
}

const DEBUG = process.env.DEBUG === "true";

export function debug(...args: unknown[]) {
    if (DEBUG) {
        console.log(...args);
    }
}
export interface TestMethod {
    method: string;
    options: TestOptions;
}

export interface TestSummary {
    testStatus: boolean;
    time: number;
}

interface BaseConfig {
    server: {
        hostname: string;
        port: number;
    }
    db: {
        mongo: {
            url: string,
        }
    };
}

export class BaseTestSet {
    
    private serverProcess: ChildProcess|null = null;
    private serverProcessDefer: Deferred<number>|null = null;
    private dbManager!: MongoDbManager;
    protected config!: object&BaseConfig;
    private configPath = "/tmp/config.json";
    private defaultConfig = {
        "cloudUrl": "http://localhost:8101",
        "server": {
            "port": 3001,
            "hostname": "0.0.0.0",
            "workers": 1,
        },
        "db": {
            "mongo": {
                "url": process.env.MONGO_URL || "mongodb://localhost:27017",
                "dbName": "privmx_e2e_tests",
            },
        },
        "request": {
            "filesDir": "/tmp/privmx-bridge-e2e-tests/files",
            "tmpDir": "/tmp/privmx-bridge-e2e-tests/tmp",
        },
        "dbMigrationId": "Migration048FixAclCache",
    };
    
    protected apis!: {
        connection: PrivmxRpc.AuthorizedConnection
        contextApi: ContextApiClient;
        threadApi: ThreadApiClient;
        storeApi: StoreApiClient;
        inboxApi: InboxApiClient;
        requestApi: RequestApiClient;
        userApi: UserApiClient;
        streamApi: StreamApiClient;
        kvdbApi: KvdbApiClient;
    };
    
    protected plainApis!: {
        jsonRpcClient: JsonRpcClient;
        managerApi: ManagerApiClient;
        solutionApi: ManagementSolutionApiClient;
        contextApi: ManagementContextApiClient
        threadApi: ManagementThreadApiClient;
        storeApi: ManagementStoreApiClient;
        inboxApi: ManagementInboxApiClient;
        streamApi: ManagementStreamApiClient;
        kvdbApi: ManagementKvdbApiClient;
    };
    
    protected helpers = {
        /** Authorizes all plain apis with api key */
        authorizePlainApi: () => {
            this.plainApis.jsonRpcClient.setHeader("Authorization", `Basic ${btoa(`${testData.apiKeyId}:${testData.apiKeySecret}`)}`);
        },
        
        /** Subscribes to channel on main api */
        subscribeToChannel: async (channel: string) => {
            return await this.apis.connection.call("subscribeToChannel", {channel}, {channelType: "websocket"});
        },
        
        /** Unsubscribes from channel on main api */
        unsubscribeFromChannel: async (channel: string) => {
            await this.apis.connection.call("unsubscribeFromChannel", {channel}, {channelType: "websocket"});
        },
        
        /** Subscribes to channel on main api */
        subscribeToChannels: async (channels: string[]): Promise<{subscriptions: types.core.Subscription[]}> => {
            return await this.apis.connection.call("subscribeToChannels", {channels: channels}, {channelType: "websocket"});
        },
        
        /** Unsubscribes from channel on main api */
        unsubscribeFromChannels: async (subscriptionsIds: types.core.SubscriptionId[]) => {
            await this.apis.connection.call("unsubscribeFromChannels", {subscriptionsIds}, {channelType: "websocket"});
        },
        
        /** Adds event listener on main api */
        addEventListenerForNotification: (callback: (evt: PrivmxRpc.Types.NotificationEvent) => void) => {
            this.apis.connection.addEventListener("notification", callback);
        },
        
        /** Creates and returns new connection with main api */
        createNewConnection: async (privKeyWif: string, solutionId: types.cloud.SolutionId) => {
            const serverUrl = "http://" + this.config.server.hostname + ":" + this.config.server.port;
            const connectionOptions: PrivmxRpc.Types.ConnectionOptions = {
                url: serverUrl + "/api/v2.0",
                host: "localhost",
            };
            const priv = PrivmxRpc.crypto.ecc.PrivateKey.fromWIF(privKeyWif);
            const conn = await PrivmxRpc.rpc.createEcdhexConnection({key: await priv, solution: solutionId}, connectionOptions);
            return conn;
        },
        
        /** Generates and returns UUID for resourceId */
        generateResourceId: () => {
            return Crypto.uuidv4() as types.core.ClientResourceId;
        },
    };
    
    async run(test: TestMethod, workerId?: number) {
        const startTimestamp = DateUtils.now();
        try {
            if (workerId) {
                this.defaultConfig.server.port += workerId;
                this.defaultConfig.db.mongo.dbName += "-" + workerId;
                this.configPath = "/tmp/config" + workerId + ".json";
            }
            await this.connectToMongo();
            const method = (<any> this)[test.method];
            const testStatus = await this.testWrapper(test.method, test.options, () => (method.call(this)));
            const endTimestamp = DateUtils.now();
            const summary: TestSummary = {
                testStatus,
                time: (endTimestamp - startTimestamp) / 1000,
            };
            return summary;
        }
        catch (e) {
            console.log(e);
            const endTimestamp = DateUtils.now();
            return {
                testStatus: false,
                time: (endTimestamp - startTimestamp) / 1000,
            };
        }
        finally {
            await this.cleanup();
        }
    }
    
    private async testWrapper(testName: string, options: TestOptions, test: () => Promise<void>) {
        try {
            debug(testName + " Dropping database...");
            const dropResult = await this.dbManager.getDb().dropDatabase();
            debug(testName + " Drop db result", dropResult);
            debug(testName + " Preparing config..");
            this.prepareConfig(options.config);
            debug(testName + " Performing migrations...");
            await this.performMigrations();
            debug(testName + " Loading dataset...");
            await this.loadDataset(options.dataSet);
            debug(testName + " Starting server...");
            await this.startServer();
            debug(testName + " Starting client...");
            await this.loadApis();
            debug(testName + " Running test...");
            const result = await this.executeTest(test, testName);
            debug(testName + " End");
            return result;
        }
        finally {
            if (this.serverProcess) {
                if (this.serverProcess.pid) {
                    debug("Sending SIGINT to server");
                    process.kill(-this.serverProcess.pid, "SIGINT");
                }
                else {
                    console.log("[WARN] No server pid so cannot send SIGINT");
                }
                this.serverProcess = null;
            }
            else {
                console.log("[WARN] No server cannot send SIGINT");
            }
            if (this.serverProcessDefer) {
                debug("Cleanup Waiting for server to exit...");
                const code = await this.serverProcessDefer.promise;
                this.serverProcessDefer = null;
                debug(`Cleanup Server exit with code ${code}`);
            }
            else {
                console.log("[WARN] No server cannot wait to exit");
            }
        }
    }
    
    private async executeTest(test: () => Promise<void>, testName: string) {
        try {
            await test();
            console.log("\x1b[33m", this.constructor.name + " " + testName + "...", "\x1b[32m", " PASSED");
            return true;
        }
        catch (e) {
            console.log("\x1b[33m", this.constructor.name + " " + testName + "...", "\x1b[31m", " FAILED");
            console.log(e);
            return false;
        }
    }
    
    private async loadApis() {
        const serverUrl = "http://" + this.config.server.hostname + ":" + this.config.server.port;
        const connectionOptions: PrivmxRpc.Types.ConnectionOptions = {
            url: serverUrl + "/api/v2.0",
            host: "localhost",
        };
        const priv = PrivmxRpc.crypto.ecc.PrivateKey.fromWIF(testData.userPrivKey);
        const conn = await PrivmxRpc.rpc.createEcdhexConnection({key: await priv, solution: testData.solutionId}, connectionOptions);
        this.apis = {
            connection: conn,
            contextApi: new ContextApiClient(conn),
            threadApi: new ThreadApiClient(conn),
            storeApi: new StoreApiClient(conn),
            inboxApi: new InboxApiClient(conn),
            requestApi: new RequestApiClient(conn),
            userApi: new UserApiClient(conn),
            streamApi: new StreamApiClient(conn),
            kvdbApi: new KvdbApiClient(conn),
        };
        const jsonRpcClient = new JsonRpcClient(serverUrl + "/api", {
            "Content-type": "application/json",
        });
        this.plainApis = {
            jsonRpcClient: jsonRpcClient,
            contextApi: new ManagementContextApiClient(jsonRpcClient),
            solutionApi: new ManagementSolutionApiClient(jsonRpcClient),
            managerApi: new ManagerApiClient(jsonRpcClient),
            inboxApi: new ManagementInboxApiClient(jsonRpcClient),
            storeApi: new ManagementStoreApiClient(jsonRpcClient),
            streamApi: new ManagementStreamApiClient(jsonRpcClient),
            threadApi: new ManagementThreadApiClient(jsonRpcClient),
            kvdbApi: new ManagementKvdbApiClient(jsonRpcClient),
        };
    }
    
    private async performMigrations() {
        const {serverProcess} = await this.spawnServerProcess(this.configPath, {...process.env, "PMX_MIGRATION": "Migration048FixAclCache"});
        const status = await this.onServerReady(() => {
            if (serverProcess.pid) {
                process.kill(-serverProcess.pid, "SIGINT");
            }
        });
        if (!status.success) {
            if (serverProcess.pid) {
                process.kill(-serverProcess.pid, "SIGINT");
            }
            throw new Error("CANNOT PERFORM MIGRATIONS");
        }
    }
    
    private async startServer() {
        const {serverProcess, defer} = await this.spawnServerProcess(this.configPath, {...process.env});
        this.serverProcess = serverProcess;
        this.serverProcessDefer = defer;
        const status = await this.onServerReady();
        if (!status.success) {
            if (this.serverProcess.pid) {
                process.kill(-this.serverProcess.pid, "SIGINT");
            }
            throw new Error("CANNOT CONNECT TO SERVER");
        }
    }
    
    private readDataSet(dataSetName: string): Collection[] {
        const dataSetPath = path.resolve(__dirname, "../../../src/test/datasets/" + dataSetName);;
        const fileNames = fs.readdirSync(dataSetPath);
        const dataSet: Collection[] = [];
        
        for (const fileName of fileNames) {
            const filePath = path.join(dataSetPath, fileName);
            if (path.extname(fileName) !== ".json") {
                continue;
            }
            const collectionName = fileName.slice(0, -5);
            const fileContent = fs.readFileSync(filePath, "utf8");
            const parsedContent = JSON.parse(fileContent);
            dataSet.push({
                name: collectionName,
                content: parsedContent,
            });
        }
        return dataSet;
    }
    
    private async loadDataset(dataSetName?: string) {
        const dataSet = this.readDataSet((dataSetName) ? dataSetName : "defaultDataset");
        for (const collectionData of dataSet) {
            const collection = this.dbManager.getCollectionByName<any>(collectionData.name);
            if (collectionData.content.length > 0) {
                await collection.insertMany(collectionData.content);
            }
        }
    }
    
    private async connectToMongo() {
        this.dbManager = new MongoDbManager(
            new MongoClient(this.defaultConfig.db.mongo.url),
            new Logger("Tests", "TestLogger", 0, new ConsoleAppender(), true),
            new MetricService(),
        );
        this.dbManager.init(this.defaultConfig.db.mongo.dbName);
    }
    
    private async cleanup() {
        await this.dbManager.getDb().dropDatabase();
        await this.dbManager.close();
    }
    
    private prepareConfig(userConfig?: object) {
        this.config = this.defaultConfig;
        if (userConfig) {
            ConfigLoader.overwriteOptions(this.config, userConfig);
        }
        fs.writeFileSync(this.configPath, JSON.stringify(this.config));
    }
    
    private async spawnServerProcess(configPath: string, env?: NodeJS.ProcessEnv) {
        const defer = PromiseUtils.defer();
        const serverProcess = spawn("node", ["./out/index.js", configPath], {detached: true, env});
        serverProcess.stdout?.on("data", d => debug("--------- [server][out]", d.toString()));
        serverProcess.stderr?.on("data", d => debug("--------- [server][err]", d.toString()));
        serverProcess.on("exit", code => {
            debug(`Server process exit with code ${code}`);
            defer.resolve(code || 999);
        });
        return {serverProcess, defer};
    }
    
    private async onServerReady(onReady?: () => void) {
        const serverUrl = "http://" + this.config.server.hostname + ":" + this.config.server.port + "/privmx-configuration.json";
        const deadline = DateUtils.nowAdd(DateUtils.seconds(30));
        while (DateUtils.now() < deadline) {
            const response = await Utils.tryPromise(() => HttpClient2.get(serverUrl, {}));
            if (response.success) {
                if (onReady) {
                    onReady();
                }
                return {success: true};
            }
            await PromiseUtils.wait(100);
        }
        return {success: false};
    }
}

export interface TestSet  {
    testConstructor: new() => BaseTestSet;
    tests: TestMethod[];
}

export class TestScanner {
    
    private testSets: TestSet[] = [];
    
    static async scan(dirPath: string, filter?: RegExp) {
        const scanner = new TestScanner();
        await scanner.scan(dirPath, filter);
        return scanner.testSets;
    }
    
    private async scan(dirPath: string, filter?: RegExp) {
        const entries = fs.readdirSync(dirPath);
        for (const entry of entries) {
            const entryPath = path.resolve(dirPath, entry);
            if (fs.statSync(entryPath).isDirectory()) {
                await this.scan(entryPath, filter);
            }
            else if (entry.endsWith("test.js") && ((filter) ? filter.test(entry) : true)) {
                try {
                    const module = await import(entryPath);
                    for (const key in module) {
                        const constructor = module[key];
                        const instance = new constructor();
                        if (instance.__exportedTests && Array.isArray(instance.__exportedTests)) {
                            const tests = instance.__exportedTests as TestMethod[];
                            this.testSets.push({
                                testConstructor: constructor,
                                tests,
                            });
                        }
                    }
                }
                catch (e) {
                    console.log(`Error during including test ${entryPath}`, e);
                }
            }
        }
    }
}
