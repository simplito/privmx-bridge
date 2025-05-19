/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Config } from "../common/ConfigUtils";
import { MethodExecutor } from "../common/MethodExecutor";
import * as mongodb from "mongodb";
import { WorkersHolder } from "./WorkersHolder";
import { IpcRequester } from "../common/IpcRequester";
import { IpcExecutor } from "../common/IpcExecutor";
import { DeferredMap } from "../common/DeferredMap";
import { IpcListener } from "../common/IpcListener";
import { Worker2Service } from "./Worker2Service";
import { IpcMessageProcessor } from "../common/IpcMessageProcessor";
import { LoggerFactory } from "../../service/log/LoggerFactory";
import { IpRateLimiterImpl } from "./IpRateLimiterImpl";
import { JobService } from "../../service/job/JobService";
import { NonceMap } from "./ipcServices/NonceMap";
import { CacheWithTTL } from "../../utils/CacheWithTTL";
import { IpcRegistryService } from "./ipcServices/IpcRegistryService";
import { MasterPlugin } from "../../service/plugin/Plugin";
import { Callbacks } from "../../service/event/Callbacks";
import { MetricsContainer } from "./ipcServices/MetricsContainer";
import { ActiveUsersMap } from "./ipcServices/ActiveUsers";
import { LockService } from "./ipcServices/LockService";

export class MasterRegistry {
    
    private config?: Config;
    private methodExecutor?: MethodExecutor;
    private worker2Service?: Worker2Service;
    private mongoClient?: mongodb.MongoClient;
    private workersHolder?: WorkersHolder;
    private ipcRequestMap?: DeferredMap;
    private ipcListener?: IpcListener;
    private ipcRequester?: IpcRequester;
    private ipcExecutor?: IpcExecutor;
    private ipcMessageProcessor?: IpcMessageProcessor;
    private ipRateLimiter?: IpRateLimiterImpl;
    private jobService?: JobService;
    private nonceMap?: NonceMap;
    private activeUsersMap?: ActiveUsersMap;
    private metricsContainer?: MetricsContainer;
    private ipcRegistryService?: IpcRegistryService;
    private callbacks?: Callbacks;
    private plugins: MasterPlugin[] = [];
    private lockService?: LockService;
    
    constructor(
        private loggerFactory: LoggerFactory,
    ) {
    }
    
    addPlugin(plugin: MasterPlugin) {
        this.plugins.push(plugin);
    }
    
    getLoggerFactory() {
        return this.loggerFactory;
    }
    
    registerConfig(config: Config) {
        if (this.config) {
            throw new Error("Config already registered");
        }
        return this.config = config;
    }
    
    registerMongoClient(mongoClient: mongodb.MongoClient) {
        if (this.mongoClient) {
            throw new Error("MongoClient already registered");
        }
        return this.mongoClient = mongoClient;
    }
    
    getConfig() {
        if (!this.config) {
            throw new Error("Config not registered yet");
        }
        return this.config;
    }
    
    getMongoClient() {
        if (!this.mongoClient) {
            throw new Error("MongoClient not registered yet");
        }
        return this.mongoClient;
    }
    
    getMethodExecutor() {
        if (!this.methodExecutor) {
            this.methodExecutor = new MethodExecutor();
        }
        return this.methodExecutor;
    }
    
    getIpRateLimiter() {
        if (!this.ipRateLimiter) {
            this.ipRateLimiter = new IpRateLimiterImpl(this.getConfig());
        }
        return this.ipRateLimiter;
    }
    
    registerIpcServices() {
        const methodExecutor = this.getMethodExecutor();
        methodExecutor.register(this.getWorker2Service());
        methodExecutor.register(this.getIpRateLimiter());
        methodExecutor.register(this.getNonceMap());
        methodExecutor.register(this.getMetricContainer());
        methodExecutor.register(this.getIpcRegistryService());
        methodExecutor.register(this.getActiveUsersMap());
        methodExecutor.register(this.getLockService());
        this.getCallbacks().triggerSync("registerIpcServices", []);
    }
    
    getIpcExecutor() {
        if (!this.ipcExecutor) {
            this.ipcExecutor = new IpcExecutor(
                this.getMethodExecutor(),
                this.getLoggerFactory().get(IpcExecutor),
            );
        }
        return this.ipcExecutor;
    }
    
    getWorker2Service() {
        if (!this.worker2Service) {
            this.worker2Service = new Worker2Service(
                this.getIpcRequester(),
                this.getWorkersHolder(),
            );
        }
        return this.worker2Service;
    }
    
    getWorkersHolder() {
        if (!this.workersHolder) {
            this.workersHolder = new WorkersHolder(
                this.getLoggerFactory().get(WorkersHolder),
            );
        }
        return this.workersHolder;
    }
    
    getIpcRequestMap() {
        if (!this.ipcRequestMap) {
            this.ipcRequestMap = new DeferredMap();
        }
        return this.ipcRequestMap;
    }
    
    getIpcListener() {
        if (!this.ipcListener) {
            this.ipcListener = new IpcListener(
                this.getIpcRequestMap(),
                this.getLoggerFactory().get(IpcListener),
            );
        }
        return this.ipcListener;
    }
    
    getIpcRequester() {
        if (!this.ipcRequester) {
            this.ipcRequester = new IpcRequester(
                this.getIpcRequestMap(),
            );
        }
        return this.ipcRequester;
    }
    
    getIpcMessageProcessor() {
        if (!this.ipcMessageProcessor) {
            this.ipcMessageProcessor = new IpcMessageProcessor(
                this.getIpcExecutor(),
                this.getIpcListener(),
                this.getLoggerFactory().get(IpcMessageProcessor),
            );
        }
        return this.ipcMessageProcessor;
    }
    
    getJobService() {
        if (!this.jobService) {
            this.jobService = new JobService(this.getLoggerFactory().get(JobService));
        }
        return this.jobService;
    }
    
    getCallbacks() {
        if (this.callbacks == null) {
            this.callbacks = new Callbacks(
                this.getJobService(),
            );
        }
        return this.callbacks;
    }
    
    getNonceMap() {
        if (this.nonceMap == null) {
            this.nonceMap = new NonceMap(
                new CacheWithTTL(),
            );
        }
        return this.nonceMap;
    }
    
    getLockService() {
        if (this.lockService == null) {
            this.lockService = new LockService();
        }
        return this.lockService;
    }
    
    getActiveUsersMap() {
        if (this.activeUsersMap == null) {
            this.activeUsersMap = new ActiveUsersMap();
        }
        return this.activeUsersMap;
    }
    
    getMetricContainer() {
        if (this.metricsContainer == null) {
            this.metricsContainer = new MetricsContainer();
        }
        return this.metricsContainer;
    }
    
    getIpcRegistryService() {
        if (this.ipcRegistryService == null) {
            this.ipcRegistryService = new IpcRegistryService();
        }
        return this.ipcRegistryService;
    }
}
