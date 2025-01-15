/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Config } from "../common/ConfigUtils";
import type * as Cluster from "cluster";
import * as http from "http";
import * as https from "https";
import * as mongodb from "mongodb";
import { HttpHandler } from "./HttpHandler";
import { WorkerIpcRequester } from "./WorkerIpcRequester";
import { WebSocketInnerManager } from "../../service/ws/WebSocketInnerManager";
import { MethodExecutor } from "../common/MethodExecutor";
import { IpcExecutor } from "../common/IpcExecutor";
import { DeferredMap } from "../common/DeferredMap";
import { IpcListener } from "../common/IpcListener";
import { Worker2Service } from "./Worker2Service";
import { IpcMessageProcessor } from "../common/IpcMessageProcessor";
import { Worker2ServiceClient } from "./Worker2ServiceClient";
import { ConfigRepository } from "../../service/config/ConfigRepository";
import { TypesValidator } from "../../api/TypesValidator";
import { JobManager } from "../../service/job/JobManager";
import { LoggerFactory } from "../../service/log/LoggerFactory";
import { Callbacks } from "../../service/event/Callbacks";
import { JobService } from "../../service/job/JobService";
import { WorkerPluginsManager } from "../../service/plugin/WorkerPluginsManager";
import { MongoDebug } from "../../db/mongo/MongoDebug";
import { ServerStatsWorkerService } from "./ServerStatsWorkerService";
import { CloudAclChecker } from "../../service/cloud/CloudAclChecker";
import { IpRateLimiterClient } from "./IpRateLimiterClient";
import type { NonceMap } from "../master/ipcServices/NonceMap";
import { IpcServiceDescriptor } from "../master/Decorators";
import { MetricsContainer } from "../master/ipcServices/MetricsContainer";
import { SignatureVerificationService } from "../../service/auth/SignatureVerificationService";

export class WorkerRegistry {
    
    private worker?: Cluster.Worker;
    private config?: Config;
    private httpServer?: http.Server;
    private httpsServer?: https.Server;
    private mongoClient?: mongodb.MongoClient;
    private httpHandler?: HttpHandler;
    private worker2Service?: Worker2Service;
    private worker2ServiceClient?: Worker2ServiceClient;
    private ipcRequestMap?: DeferredMap;
    private ipcListener?: IpcListener;
    private ipcRequester?: WorkerIpcRequester;
    private webSocketInnerManager?: WebSocketInnerManager;
    private methodExecutor?: MethodExecutor;
    private ipcExecutor?: IpcExecutor;
    private ipcMessageProcessor?: IpcMessageProcessor;
    private configRepository?: ConfigRepository;
    private typesValidator?: TypesValidator;
    private jobManager?: JobManager;
    private jobService?: JobService;
    private workerCallbacks?: Callbacks;
    private workerPluginsManager?: WorkerPluginsManager;
    private serverStatsWorkerService?: ServerStatsWorkerService;
    protected cloudAclChecker?: CloudAclChecker;
    protected signatureVerificationService?: SignatureVerificationService;
    private ipRateLimiterClient?: IpRateLimiterClient;
    private ipcServices = new Map<string, any>();
    
    constructor(
        private loggerFactory: LoggerFactory,
    ) {
    }
    
    getLoggerFactory() {
        return this.loggerFactory;
    }
    
    async createMongoClient(mongoUrl: string) {
        this.registerMongoClient(MongoDebug.decorateClient(await mongodb.MongoClient.connect(mongoUrl, {minPoolSize: 5, maxPoolSize: 5})));
    }
    
    getIpRateLimiterClient() {
        if (!this.ipRateLimiterClient) {
            this.ipRateLimiterClient = new IpRateLimiterClient(this.getIpcRequester());
        }
        return this.ipRateLimiterClient;
    }

    getWorkerPluginsManager() {
        if (this.workerPluginsManager == null) {
            this.workerPluginsManager = new WorkerPluginsManager();
        }
        return this.workerPluginsManager;
    }
    
    getWorkerCallbacks() {
        if (this.workerCallbacks == null) {
            this.workerCallbacks = new Callbacks(
                this.getJobService()
            );
        }
        return this.workerCallbacks;
    }
    
    registerWorker(worker: Cluster.Worker) {
        if (this.worker) {
            throw new Error("Worker already registered");
        }
        this.worker = worker;
    }
    
    registerConfig(config: Config) {
        if (this.config) {
            throw new Error("Config already registered");
        }
        return this.config = config;
    }
    
    registerHttpServer(httpServer: http.Server) {
        if (this.httpServer) {
            throw new Error("Server already registered");
        }
        return this.httpServer = httpServer;
    }
    
    registerHttpsServer(httpsServer: https.Server) {
        if (this.httpsServer) {
            throw new Error("Server already registered");
        }
        return this.httpsServer = httpsServer;
    }
    
    registerMongoClient(mongoClient: mongodb.MongoClient) {
        if (this.mongoClient) {
            throw new Error("MongoClient already registered");
        }
        return this.mongoClient = mongoClient;
    }
    
    getWorker() {
        if (!this.worker) {
            throw new Error("Worker not registered yet");
        }
        return this.worker;
    }
    
    getConfig() {
        if (!this.config) {
            throw new Error("Config not registered yet");
        }
        return this.config;
    }
    
    getHttpServer() {
        if (!this.httpServer) {
            throw new Error("HTTP Server not registered yet");
        }
        return this.httpServer;
    }
    
    getHttpsServer() {
        if (!this.httpsServer) {
            throw new Error("HTTPS Server not registered yet");
        }
        return this.httpsServer;
    }
    
    getMongoClient() {
        if (!this.mongoClient) {
            throw new Error("MongoClient not registered yet");
        }
        return this.mongoClient;
    }
    
    getHttpHandler() {
        if (!this.httpHandler) {
            this.httpHandler = new HttpHandler(
                this.getConfig(),
                this.getWebSocketInnerManager(),
                this.getLoggerFactory().get(HttpHandler),
                this,
                this.getConfigRepository(),
            );
        }
        return this.httpHandler;
    }
    
    getWorker2Service() {
        if (!this.worker2Service) {
            this.worker2Service = new Worker2Service(
                this.getWebSocketInnerManager(),
            );
        }
        return this.worker2Service;
    }
    
    getWorker2ServiceClient() {
        if (this.worker2ServiceClient == null) {
            this.worker2ServiceClient = new Worker2ServiceClient(
                this.getIpcRequester(),
            );
        }
        return this.worker2ServiceClient;
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
            this.ipcRequester = new WorkerIpcRequester(
                this.getIpcRequestMap(),
                this.getWorker(),
            );
        }
        return this.ipcRequester;
    }
    
    getWebSocketInnerManager() {
        if (this.webSocketInnerManager == null) {
            this.webSocketInnerManager = new WebSocketInnerManager();
        }
        return this.webSocketInnerManager;
    }
    
    getMethodExecutor() {
        if (!this.methodExecutor) {
            this.methodExecutor = new MethodExecutor();
        }
        return this.methodExecutor;
    }
    
    registerIpcServices() {
        const methodExecutor = this.getMethodExecutor();
        methodExecutor.register(this.getWorker2Service());
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
    
    getConfigRepository() {
        if (!this.configRepository) {
            this.configRepository = new ConfigRepository(
                this.getMongoClient()
            );
        }
        return this.configRepository;
    }
    
    getTypesValidator() {
        if (this.typesValidator == null) {
            this.typesValidator = new TypesValidator();
        }
        return this.typesValidator;
    }
    
    getJobManager() {
        if (!this.jobManager) {
            this.jobManager = new JobManager(
                this.getLoggerFactory().get(JobManager),
            );
        }
        return this.jobManager;
    }
    
    getJobService() {
        if (!this.jobService) {
            this.jobService = new JobService(
                this.getLoggerFactory().get(JobService),
            );
        }
        return this.jobService;
    }
    
    getServerStatsWorkerService() {
        if (!this.serverStatsWorkerService) {
            this.serverStatsWorkerService = new ServerStatsWorkerService(
                this.getConfig(),
                this.getJobService(),
                this.getMongoClient(),
            );
        }
        return this.serverStatsWorkerService;
    }
    
    getCloudAclChecker() {
        if (this.cloudAclChecker == null) {
            this.cloudAclChecker = new CloudAclChecker();
        }
        return this.cloudAclChecker;
    }
    
    getNonceMap() {
        return this.getIpcService<NonceMap>("nonceMap");
    }

    getMetricsContainer() {
        return this.getIpcService<MetricsContainer>("metricsContainer");
    }
    
    getIpcService<T>(serviceName: string) {
        const service = this.ipcServices.get(serviceName);
        if (!service) {
            throw new Error(`IPC service with name '${serviceName}' not yet initialized`);
        }
        return service as T;
    }

    getSignatureVerificationService() {
        if (this.signatureVerificationService == null) {
            this.signatureVerificationService = new SignatureVerificationService(
                this.getNonceMap(),
            );
        }
        return this.signatureVerificationService;
    }
    
    async initIpc() {
        const requester = this.getIpcRequester();
        const descriptors = await requester.request<IpcServiceDescriptor[]>("getIpcServiceRegistry", {});
        for (const ipcService of descriptors) {
            const service: Record<string, any> = {};
            for (const method of ipcService.methods) {
                service[method] = ((m: string) => {
                    return (params: unknown) => {
                        return requester.request(m, typeof(params) === "undefined" ? {} : params);
                    };
                })(method);
            }
            this.ipcServices.set(ipcService.classNameLower, service);
        }
    }
}
