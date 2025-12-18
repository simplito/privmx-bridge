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
import { WebsocketCommunicationManger } from "./ipcServices/WebsocketCommunicationManager";
import { IBrokerClient } from "../common/BrokerClient";
import { MetricsCollector } from "../../service/misc/MetricsCollector";
import { AggregatedNotificationsService } from "../../service/cloud/AggregatedNotificationsService";
import { ZeroMQBroker } from "./ZeroMQBroker";

export class MasterRegistry {
    
    private config?: Config;
    private methodExecutor?: MethodExecutor;
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
    private websocketCommunicationManager?: WebsocketCommunicationManger;
    private aggregatedNotificationsService?: AggregatedNotificationsService;
    private metricsCollector?: MetricsCollector;
    private zeroMQBroker?: ZeroMQBroker;
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
    
    getBroker() {
        const config = this.getConfig();
        if (config.server.broker.mode === "internal") {
            return this.getZeroMQBroker();
        }
        else {
            return null;
        }
    }
    
    getZeroMQBroker() {
        if (!this.zeroMQBroker) {
            this.zeroMQBroker = new ZeroMQBroker(
                this.getLoggerFactory().createLogger(ZeroMQBroker),
                this.getConfig(),
            );
        }
        return this.zeroMQBroker;
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
        methodExecutor.register(this.getIpRateLimiter());
        methodExecutor.register(this.getNonceMap());
        methodExecutor.register(this.getMetricContainer());
        methodExecutor.register(this.getIpcRegistryService());
        methodExecutor.register(this.getActiveUsersMap());
        methodExecutor.register(this.getLockService());
        methodExecutor.register(this.getWebsocketCommunicationManager());
        methodExecutor.register(this.getAggregatedNotificationsService());
        this.getCallbacks().triggerSync("registerIpcServices", []);
    }
    
    getIpcExecutor() {
        if (!this.ipcExecutor) {
            this.ipcExecutor = new IpcExecutor(
                this.getMethodExecutor(),
                this.getLoggerFactory().createLogger(IpcExecutor),
            );
        }
        return this.ipcExecutor;
    }
    
    getWorkersHolder() {
        if (!this.workersHolder) {
            this.workersHolder = new WorkersHolder(
                this.getLoggerFactory().createLogger(WorkersHolder),
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
                this.getLoggerFactory().createLogger(IpcListener),
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
                this.getLoggerFactory().createLogger(IpcMessageProcessor),
            );
        }
        return this.ipcMessageProcessor;
    }
    
    getSubscriberMock() {
        const subMock = {};
        return subMock as IBrokerClient;
    }
    
    getJobService() {
        if (!this.jobService) {
            this.jobService = new JobService(this.getLoggerFactory().createLogger(JobService));
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
    
    getWebsocketCommunicationManager() {
        if (this.websocketCommunicationManager == null) {
            this.websocketCommunicationManager = new WebsocketCommunicationManger(
                this.getIpcRequester(),
                this.getWorkersHolder(),
            );
        }
        return this.websocketCommunicationManager;
    }
    
    getAggregatedNotificationsService() {
        if (!this.aggregatedNotificationsService) {
            this.aggregatedNotificationsService = new AggregatedNotificationsService(
                this.getActiveUsersMap(),
            );
        }
        return this.aggregatedNotificationsService;
    }
    
    getMetricContainer() {
        if (this.metricsContainer == null) {
            this.metricsContainer = new MetricsContainer(
                this.getMetricsCollector(),
            );
        }
        return this.metricsContainer;
    }
    
    getIpcRegistryService() {
        if (this.ipcRegistryService == null) {
            this.ipcRegistryService = new IpcRegistryService();
        }
        return this.ipcRegistryService;
    }
    
    getMetricsCollector() {
        if (this.metricsCollector == null) {
            this.metricsCollector = new MetricsCollector();
        }
        return this.metricsCollector;
    }
    
}
