/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Callbacks } from "../event/Callbacks";
import { SessionStorage } from "../../api/session/SessionStorage";
import { SettingsService } from "../misc/SettingsService";
import { NonceService } from "../misc/NonceService";
import { DbManager, BinaryRepositoryFactoryFunc } from "../../db/DbManager";
import { ConfigService } from "../config/ConfigService";
import { UserLoginService } from "../login/UserLoginService";
import { SrpLogic } from "../../utils/crypto/SrpLogic";
import { TicketsDb } from "../../api/tls/TicketsDb";
import { MongoDbManager } from "../../db/mongo/MongoDbManager";
import { SessionCleaner } from "../../api/session/SessionCleaner";
import { ServerSessionService } from "../../api/session/ServerSessionService";
import { ServerStatsService } from "../misc/ServerStatsService";
import { InitApi } from "../../api/plain/init/InitApi";
import { InitApiValidator } from "../../api/plain/init/InitApiValidator";
import { ApiResolver } from "../../api/ApiResolver";
import { LoginLogService } from "../login/LoginLogService";
import { JobManager } from "../job/JobManager";
import { JobService } from "../job/JobService";
import { IBinaryRepositoryFactory } from "../../db/BinaryRepository";
import { PluginsManager } from "../plugin/PluginsManager";
import { App } from "../app/App";
import { PrivmxExpressApp } from "../app/PrivmxExpressApp";
import { ConfigLoader, ConfigLoaderFunc, ConfigValues } from "../config/ConfigLoader";
import { MaintenanceService } from "../misc/MaintenanceService";
import { RequestContextFactory } from "../../api/RequestContextFactory";
import * as types from "../../types";
import { SrpConfigService } from "../login/SrpConfigService";
import { ServerAgent } from "../../api/ServerAgent";
import { ClientIpService } from "../misc/ClientIpService";
import { RequestService } from "../request/RequestService";
import { FileSystemService } from "../request/FileSystemService";
import { HostHttpHandler } from "../../cluster/worker/HostHttpHandler";
import { WorkerRegistry } from "../../cluster/worker/WorkerRegistry";
import { FileSystemStorageService } from "../misc/FileSystemStorageService";
import { IStorageService } from "../misc/StorageService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { PkiFactory } from "../pki/PkiFactory";
import { PacketValidator } from "../../api/tls/PacketValidator";
import { RequestApiValidator } from "../../api/main/request/RequestApiValidator";
import { UserApiValidator } from "../../api/main/user/UserApiValidator";
import { TicketKeyHolder } from "../../api/tls/TicketKeyHolder";
import { WebSocketConnectionManager, SimpleWebSocketConnectionManager } from "../ws/WebSocketConnectionManager";
import { WebSocketSender } from "../ws/WebSocketSender";
import { NodeHelper } from "../../utils/NodeHelper";
import { MetricService } from "../misc/MetricService";
import { ContextService } from "../cloud/ContextService";
import { ThreadService } from "../cloud/ThreadService";
import { ContextApiValidator } from "../../api/main/context/ContextApiValidator";
import { ThreadApiValidator } from "../../api/main/thread/ThreadApiValidator";
import { ThreadConverter } from "../../api/main/thread/ThreadConverter";
import { CloudKeyService } from "../cloud/CloudKeyService";
import { ThreadNotificationService } from "../cloud/ThreadNotificationService";
import { StoreApiValidator } from "../../api/main/store/StoreApiValidator";
import { StoreConverter } from "../../api/main/store/StoreConverter";
import { StoreService } from "../cloud/StoreService";
import { StoreNotificationService } from "../cloud/StoreNotificationService";
import { InboxConverter } from "../../api/main/inbox/InboxConverter";
import { InboxNotificationService } from "../cloud/InboxNotificationService";
import { InboxService } from "../cloud/InboxService";
import { InboxApiValidator } from "../../api/main/inbox/InboxApiValidator";
import { StreamService } from "../cloud/StreamService";
import { StreamConverter } from "../../api/main/stream/StreamConverter";
import { StreamApiValidator } from "../../api/main/stream/StreamApiValidator";
import { StreamNotificationService } from "../cloud/StreamNotificationService";
import { TokenEncryptionService } from "../auth/TokenEncryptionService";
import { TokenEncryptionKeyProvider } from "../auth/TokenEncryptionKeyProvider";
import { ManagerApi } from "../../api/plain/manager/ManagerApi";
import { ManagerApiValidator } from "../../api/plain/manager/ManagerApiValidator";
import { ApiKeyService } from "../auth/ApiKeyService";
import { ManagementContextApi } from "../../api/plain/context/ManagementContextApi";
import { ManagementContextApiValidator } from "../../api/plain/context/ManagementContextApiValidator";
import { ManagementSolutionApiValidator } from "../../api/plain/solution/ManagementSolutionApiValidator";
import { ManagementSolutionApi } from "../../api/plain/solution/ManagementSolutionApi";
import { SolutionService } from "../cloud/SolutionService";
import { PolicyService } from "../cloud/PolicyService";
import { UserApi } from "../../api/main/user/UserApi";
import { RequestApi } from "../../api/main/request/RequestApi";
import { ContextApi } from "../../api/main/context/ContextApi";
import { ThreadApi } from "../../api/main/thread/ThreadApi";
import { StoreApi } from "../../api/main/store/StoreApi";
import { InboxApi } from "../../api/main/inbox/InboxApi";
import { StreamApi } from "../../api/main/stream/StreamApi";
import { MainApiResolver, RequestApiResolver } from "../../api/ServerEndpoint";
import { ManagementThreadApi } from "../../api/plain/thread/ManagementThreadApi";
import { ManagementThreadApiValidator } from "../../api/plain/thread/ManagementThreadApiValidator";
import { ManagementInboxApiValidator } from "../../api/plain/inbox/ManagementInboxApiValidator";
import { ManagementStoreApiValidator } from "../../api/plain/store/ManagementStoreApiValidator";
import { ManagementStreamApiValidator } from "../../api/plain/stream/ManagementStreamApiValidator";
import { ManagementStoreApi } from "../../api/plain/store/ManagementStoreApi";
import { ManagementStreamApi } from "../../api/plain/stream/ManagementStreamApi";
import { ManagementInboxApi } from "../../api/plain/inbox/ManagementInboxApi";
import { CloudAccessValidator } from "../cloud/CloudAccessValidator";
import { ManagementThreadConverter } from "../../api/plain/thread/ManagementThreadConverter";
import { ManagementStreamConverter } from "../../api/plain/stream/ManagementStreamConverter";
import { ManagementStoreConverter } from "../../api/plain/store/ManagementStoreConverter";
import { ManagementInboxConverter } from "../../api/plain/inbox/ManagementInboxConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import { ContextNotificationService } from "../cloud/ContextNotificationService";
import { StorageServiceProvider } from "../cloud/StorageServiceProvider";
import { ManagementKvdbApi } from "../../api/plain/kvdb/ManagementKvdbApi";
import { ManagementKvdbApiValidator } from "../../api/plain/kvdb/ManagementKvdbApiValidator";
import { KvdbService } from "../cloud/KvdbService";
import { KvdbNotificationService } from "../cloud/KvdbNotificationService";
import { KvdbConverter } from "../../api/main/kvdb/KvdbConverter";
import { ManagementKvdbConverter } from "../../api/plain/kvdb/ManagementKvdbConverter";
import { KvdbApi } from "../../api/main/kvdb/KvdbApi";
import { KvdbApiValidator } from "../../api/main/kvdb/KvdbApiValidator";
import { ServerSignatureService } from "../cloud/ServerSignatureService";
import { MongoStorageService } from "../cloud/MongoStorageService";
import { LockHelper } from "../misc/LockHelper";
import { UserStatusManager } from "../cloud/UserStatusManager";
export class IOC {
    
    takeMongoClientFromWorker = true;
    
    protected configService?: ConfigService;
    protected configLoader?: ConfigLoader;
    protected dbManager?: DbManager;
    protected nonceService?: NonceService;
    protected settingsService?: SettingsService;
    protected pkiFactory?: PkiFactory;
    protected nodeHelper?: NodeHelper;
    protected callbacks?: Callbacks;
    protected requestService?: RequestService;
    protected fileSystemService?: FileSystemService;
    protected storageService?: IStorageService;
    protected randomWriteStorageService?: IStorageService;
    protected fileSystemStorageService?: FileSystemStorageService;
    protected userLoginService?: UserLoginService;
    protected sessionCleaner?: SessionCleaner;
    protected mainApiRsolver?: MainApiResolver;
    protected srpConfigService?: SrpConfigService;
    protected sessionStorage?: SessionStorage;
    protected ticketsDb?: TicketsDb;
    protected mongoDbManager?: MongoDbManager;
    protected serverSessionService?: ServerSessionService;
    protected serverStatsService?: ServerStatsService;
    protected initApiValidator?: InitApiValidator;
    protected managerApiValidator?: ManagerApiValidator;
    protected contextApiValidator?: ContextApiValidator;
    protected plainApiResolver?: RequestApiResolver;
    protected loginLogService?: LoginLogService;
    protected jobManager?: JobManager;
    protected webSocketConnectionManager?: WebSocketConnectionManager;
    protected simpleWebSocketConnectionManager?: SimpleWebSocketConnectionManager;
    protected webSocketSender?: WebSocketSender;
    protected webSocketPlainSender?: WebSocketPlainSender;
    protected jobService?: JobService;
    protected binaryRepositoryFactoriesMap: {[name: string]: BinaryRepositoryFactoryFunc};
    protected storageProvidersMap: {[name: string]: () => IStorageService};
    protected storageServiceProvider?: StorageServiceProvider;
    protected pluginsManager?: PluginsManager;
    protected app?: App;
    protected privmxExpressApp?: PrivmxExpressApp;
    protected configLoaderFunc?: ConfigLoaderFunc;
    protected maintenanceService?: MaintenanceService;
    protected requestContextFactory?: RequestContextFactory;
    protected serverAgent?: ServerAgent;
    protected clientIpService?: ClientIpService;
    protected hostHttpHandler?: HostHttpHandler;
    public workerRegistry: WorkerRegistry;
    protected repositoryFactory?: RepositoryFactory;
    protected packetValidator?: PacketValidator;
    protected requestApiValidator?: RequestApiValidator;
    protected userApiValidator?: UserApiValidator;
    protected ticketKeyHolder?: TicketKeyHolder;
    protected metricService?: MetricService;
    protected contextService?: ContextService;
    protected solutionService?: SolutionService;
    protected threadService?: ThreadService;
    protected managementContextApiValidator?: ManagementContextApiValidator;
    protected managementSolutionApiValidator?: ManagementSolutionApiValidator;
    protected managementThreadApiValidator?: ManagementThreadApiValidator;
    protected managementStoreApiValidator?: ManagementStoreApiValidator;
    protected managementStreamApiValidator?: ManagementStreamApiValidator;
    protected managementInboxApiValidator?: ManagementInboxApiValidator;
    protected threadApiValidator?: ThreadApiValidator;
    protected threadConverter?: ThreadConverter;
    protected cloudKeyService?: CloudKeyService;
    protected threadNotificationService?: ThreadNotificationService;
    protected storeService?: StoreService;
    protected storeConverter?: StoreConverter;
    protected storeNotificationService?: StoreNotificationService;
    protected storeApiValidator?: StoreApiValidator;
    protected inboxApiValidator?: InboxApiValidator;
    protected inboxService?: InboxService;
    protected inboxNotificationService?: InboxNotificationService;
    protected inboxConverter?: InboxConverter;
    protected instanceHost: types.core.Host;
    protected streamApiValidator?: StreamApiValidator;
    protected streamService?: StreamService;
    protected streamConverter?: StreamConverter;
    protected streamNotificationService?: StreamNotificationService;
    protected tokenEncryptionService?: TokenEncryptionService;
    protected tokenEncryptionKeyProvider?: TokenEncryptionKeyProvider;
    protected apiKeyService?: ApiKeyService;
    protected policyService?: PolicyService;
    protected cloudAccessValidator?: CloudAccessValidator;
    protected managementThreadConverter?: ManagementThreadConverter;
    protected managementStreamConverter?: ManagementStreamConverter;
    protected managementStoreConverter?: ManagementStoreConverter;
    protected managementInboxConverter?: ManagementInboxConverter;
    protected contextNotificationService?: ContextNotificationService;
    protected managementKvdbApiValidator?: ManagementKvdbApiValidator;
    protected kvdbService?: KvdbService;
    protected kvdbNotificationService?: KvdbNotificationService;
    protected kvdbConverter?: KvdbConverter;
    protected managementKvdbConverter?: ManagementKvdbConverter;
    protected kvdbApiValidator?: KvdbApiValidator;
    protected serverSignatureService?: ServerSignatureService;
    protected mongoStorageService?: MongoStorageService;
    protected lockHelper?: LockHelper;
    protected userStatusManager?: UserStatusManager;
    
    constructor(instanceHost: types.core.Host, workerRegistry: WorkerRegistry) {
        this.instanceHost = instanceHost;
        this.workerRegistry = workerRegistry;
        this.binaryRepositoryFactoriesMap = {};
        this.storageProvidersMap = {};
        this.registerStorageProviderFactory("fs", () => this.getFileSystemStorageService());
        this.registerStorageProviderFactory("mongo", () => this.getMongoStorageService());
        this.getCallbacks().add("applyDefaultConfig", (values: ConfigValues) => {
            const config = this.workerRegistry.getConfig();
            values.db.storageProviderName = config.db.storageProviderName;
            values.db.randomWriteStorageProviderName = config.db.randomWriteStorageProviderName;
            values.request.chunkSize = config.request.chunkSize;
        });
    }
    
    getServerSignatureService() {
        if (!this.serverSignatureService) {
            this.serverSignatureService = new ServerSignatureService(
                this.workerRegistry.getNonceMap(),
                this.getPkiFactory(),
            );
        }
        return this.serverSignatureService;
    }
    
    getIpRateLimiterClient() {
        return this.workerRegistry.getIpRateLimiterClient();
    }
    
    getInstanceHost() {
        return this.instanceHost;
    }
    
    getLoggerFactory() {
        return this.workerRegistry.getLoggerFactory();
    }
    
    createLogger(value: any) {
        return this.getLoggerFactory().createLogger(value, this.instanceHost);
    }
    
    getHttpHandler() {
        if (this.hostHttpHandler == null) {
            this.hostHttpHandler = new HostHttpHandler(
                this.getPrivmxExpressApp(),
            );
        }
        return this.hostHttpHandler;
    }
    
    getApp() {
        if (!this.app) {
            throw new Error("App is not registered");
        }
        return this.app;
    }
    
    registerApp(app: App) {
        if (this.app) {
            throw new Error("App already registered");
        }
        this.app = app;
    }
    
    getPrivmxExpressApp() {
        if (this.privmxExpressApp == null) {
            this.privmxExpressApp = new PrivmxExpressApp(
                this.getConfigService(),
                this.workerRegistry.getConfig(),
                this.getCallbacks(),
                this.getRequestContextFactory(),
                this.createLogger(PrivmxExpressApp),
            );
        }
        return this.privmxExpressApp;
    }
    
    getRequestContextFactory() {
        if (this.requestContextFactory == null) {
            this.requestContextFactory = new RequestContextFactory(
                this.getServerStatsService(),
                this,
                this.getLoggerFactory(),
                this.workerRegistry.getMetricsContainer(),
                this.workerRegistry.getConfig(),
            );
        }
        return this.requestContextFactory;
    }
    
    getConfigLoaderFunc() {
        if (!this.configLoaderFunc) {
            throw new Error("ConfigLoaderFunc is not registered");
        }
        return this.configLoaderFunc;
    }
    
    registerConfigLoaderFunc(configLoaderFunc: ConfigLoaderFunc) {
        if (this.configLoaderFunc) {
            throw new Error("ConfigLoaderFunc already registered");
        }
        this.configLoaderFunc = configLoaderFunc;
    }
    
    registerBinaryRepositoryFactory(brfName: string, factory: (dbName: string) => IBinaryRepositoryFactory<any>): void {
        if (brfName in this.binaryRepositoryFactoriesMap) {
            throw new Error("Binary repository factory with name '" +  brfName + "' already registered");
        }
        this.binaryRepositoryFactoriesMap[brfName] = factory;
    }
    
    registerStorageProviderFactory(providerName: string, factory: () => IStorageService): void {
        if (providerName in this.storageProvidersMap) {
            throw new Error("Storage provider factory with name '" +  providerName + "' already registered");
        }
        this.storageProvidersMap[providerName] = factory;
    }
    
    getPluginsManager() {
        if (this.pluginsManager == null) {
            this.pluginsManager = new PluginsManager();
        }
        return this.pluginsManager;
    }
    
    loadPlugins() {
        const workerPluginsManager = this.workerRegistry.getWorkerPluginsManager();
        workerPluginsManager.loadPlugins(this, this.getPluginsManager());
    }
    
    getConfigService() {
        if (this.configService == null) {
            this.configService = new ConfigService(
                this.getConfigLoaderFunc(),
                this.getCallbacks(),
            );
        }
        return this.configService;
    }
    
    getConfigLoader() {
        if (this.configLoader == null) {
            this.configLoader = new ConfigLoader(
                this.getCallbacks(),
                this.workerRegistry.getConfig(),
            );
        }
        return this.configLoader;
    }
    
    getMaintenanceService() {
        if (this.maintenanceService == null) {
            this.maintenanceService = new MaintenanceService();
        }
        return this.maintenanceService;
    }
    
    getMongoDbManager() {
        if (this.mongoDbManager == null) {
            this.mongoDbManager = new MongoDbManager(
                this.takeMongoClientFromWorker && this.workerRegistry ? this.workerRegistry.getMongoClient() : null,
                this.createLogger(MongoDbManager),
                this.getMetricService(),
                this.workerRegistry.getDbCache(),
            );
        }
        return this.mongoDbManager;
    }
    
    getDbManager() {
        if (this.dbManager == null) {
            this.dbManager = new DbManager(
                this.getMongoDbManager(),
            );
        }
        return this.dbManager;
    }
    
    getNonceService() {
        if (this.nonceService == null) {
            this.nonceService = new NonceService(this.getRepositoryFactory(), this.getConfigService());
        }
        return this.nonceService;
    }
    
    getLoginLogService() {
        if (this.loginLogService == null) {
            this.loginLogService = new LoginLogService();
        }
        return this.loginLogService;
    }
    
    getSettingsService() {
        if (this.settingsService == null) {
            this.settingsService = new SettingsService(
                this.getRepositoryFactory(),
            );
        }
        return this.settingsService;
    }
    
    getJobManager() {
        return this.workerRegistry.getJobManager();
    }
    
    getRequestService() {
        if (this.requestService == null) {
            this.requestService = new RequestService(
                this.getConfigService(),
                this.getStorageServiceProvider(),
                this.getRepositoryFactory(),
                this.createLogger(RequestService),
            );
        }
        return this.requestService;
    }
    
    getFileSystemService() {
        if (this.fileSystemService == null) {
            this.fileSystemService = new FileSystemService(
                this.getConfigService(),
                this.createLogger(FileSystemService),
            );
        }
        return this.fileSystemService;
    }
    
    getStorageService() {
        if (this.storageService == null) {
            const storageProviderName = this.getConfigService().values.db.storageProviderName;
            this.storageService = this.resolveStorageProviderFactory(storageProviderName)();
        }
        return this.storageService;
    }
    
    getRandomWriteStorageService() {
        if (this.randomWriteStorageService == null) {
            const randomWriteStorageProviderName = this.getConfigService().values.db.randomWriteStorageProviderName;
            this.randomWriteStorageService = this.resolveStorageProviderFactory(randomWriteStorageProviderName)();
        }
        return this.randomWriteStorageService;
    }
    
    getStorageServiceProvider() {
        if (this.storageServiceProvider == null) {
            this.storageServiceProvider = new StorageServiceProvider(
                this.getStorageService(),
                this.getRandomWriteStorageService(),
            );
        }
        return this.storageServiceProvider;
    }
    
    resolveStorageProviderFactory(providerName: string) {
        const factory = this.storageProvidersMap[providerName];
        if (!factory) {
            throw new Error(`Storage provider factory with name '${providerName}' not registered`);
        }
        return factory;
    }
    
    getMongoStorageService() {
        if (this.mongoStorageService == null) {
            this.mongoStorageService = new MongoStorageService(
                this.getRepositoryFactory(),
            );
        }
        return this.mongoStorageService;
    }
    
    getFileSystemStorageService() {
        if (this.fileSystemStorageService == null) {
            this.fileSystemStorageService = new FileSystemStorageService(
                this.getFileSystemService(),
            );
        }
        return this.fileSystemStorageService;
    }
    
    getSrpConfigService() {
        if (this.srpConfigService == null) {
            this.srpConfigService = new SrpConfigService(SrpLogic.getConfig());
        }
        return this.srpConfigService;
    }
    
    getUserLoginService() {
        if (this.userLoginService == null) {
            this.userLoginService = new UserLoginService();
        }
        return this.userLoginService;
    }
    
    getTypesValidator() {
        return this.workerRegistry.getTypesValidator();
    }
    
    getNodeHelper() {
        if (this.nodeHelper == null) {
            this.nodeHelper = new NodeHelper(
                this.createLogger(NodeHelper),
            );
        }
        return this.nodeHelper;
    }
    
    getPkiFactory() {
        if (this.pkiFactory == null) {
            this.pkiFactory = new PkiFactory(
                this.getSettingsService(),
            );
        }
        return this.pkiFactory;
    }
    
    getSessionCleaner() {
        if (this.sessionCleaner == null) {
            this.sessionCleaner = new SessionCleaner(
                this.getTicketsDb(),
                this.getSessionStorage(),
                this.getWebSocketConnectionManager(),
            );
        }
        return this.sessionCleaner;
    }
    
    getCallbacks() {
        if (this.callbacks == null) {
            this.callbacks = new Callbacks(
                this.getJobService(),
            );
        }
        return this.callbacks;
    }
    
    getJobService() {
        if (this.jobService == null) {
            this.jobService = new JobService(
                this.createLogger(JobService),
            );
        }
        return this.jobService;
    }
    
    getMainApiResolver() {
        if (this.mainApiRsolver == null) {
            this.mainApiRsolver = new ApiResolver();
            this.mainApiRsolver.registerApiWithPrefix("", UserApi, ({ioc: e, sessionService: s}) =>
                new UserApi(e.ioc.getUserApiValidator(), s,
                    e.webSocket,
                    e.ioc.getSessionCleaner(),
                    e.ioc.getWebSocketConnectionManager(),
                    e.ioc.getRepositoryFactory(),
                ));
            this.mainApiRsolver.registerApiWithPrefix("", RequestApi, ({ioc: e, sessionService: s}) => new RequestApi(e.ioc.getRequestApiValidator(), s, e.ioc.getRequestService()));
            this.mainApiRsolver.registerApiWithPrefix("request.", RequestApi, ({ioc: e, sessionService: s}) => new RequestApi(e.ioc.getRequestApiValidator(), s, e.ioc.getRequestService()));
            this.mainApiRsolver.registerApiWithPrefix("context.", ContextApi, ({ioc: e, sessionService: s}) => new ContextApi(e.ioc.getContextApiValidator(), e.ioc.getContextService(), s));
            this.mainApiRsolver.registerApiWithPrefix("thread2.", ThreadApi, ({ioc: e, sessionService: s}) => new ThreadApi(e.ioc.getThreadApiValidator(), e.ioc.getThreadService(), s, e.ioc.getThreadConverter(), e.getRequestLogger()));
            this.mainApiRsolver.registerApiWithPrefix("thread.", ThreadApi, ({ioc: e, sessionService: s}) => new ThreadApi(e.ioc.getThreadApiValidator(), e.ioc.getThreadService(), s, e.ioc.getThreadConverter(), e.getRequestLogger()));
            this.mainApiRsolver.registerApiWithPrefix("store.", StoreApi, ({ioc: e, sessionService: s}) => new StoreApi(e.ioc.getStoreApiValidator(), s, e.ioc.getStoreService(), e.ioc.getStoreConverter(), e.getRequestLogger()));
            this.mainApiRsolver.registerApiWithPrefix("inbox.", InboxApi, ({ioc: e, sessionService: s}) => new InboxApi(e.ioc.getInboxApiValidator(), s, e.ioc.getInboxService(), e.ioc.getInboxConverter(), e.getRequestLogger()));
            this.mainApiRsolver.registerApiWithPrefix("stream.", StreamApi, ({ioc: e, sessionService: s}) => new StreamApi(e.ioc.getStreamApiValidator(), s, e.ioc.getStreamService(), e.ioc.getStreamConverter(), e.getRequestLogger()));
            this.mainApiRsolver.registerApiWithPrefix("kvdb.", KvdbApi, ({ioc: e, sessionService: s}) => new KvdbApi(e.ioc.getKvdbApiValidator(), s, e.ioc.getKvdbService(), e.ioc.getKvdbConverter(), e.getRequestLogger()));
            
            this.getPluginsManager().registerEndpoint(this.mainApiRsolver);
        }
        return this.mainApiRsolver;
    }
    
    getSessionStorage() {
        if (this.sessionStorage == null) {
            this.sessionStorage = new SessionStorage(
                this.getRepositoryFactory(),
            );
        }
        return this.sessionStorage;
    }
    
    getTicketsDb() {
        if (this.ticketsDb == null) {
            this.ticketsDb = new TicketsDb(
                this.getConfigService(),
                this.getTicketKeyHolder(),
                this.getRepositoryFactory(),
                this.getSessionStorage(),
            );
        }
        return this.ticketsDb;
    }
    
    getServerSessionService() {
        if (this.serverSessionService == null) {
            this.serverSessionService = new ServerSessionService(
                this.getConfigService(),
            );
        }
        return this.serverSessionService;
    }
    
    getServerStatsService() {
        if (this.serverStatsService == null) {
            this.serverStatsService = new ServerStatsService(
                this.getInstanceHost(),
                this.getMongoDbManager(),
                this.workerRegistry.getServerStatsWorkerService(),
                this.getRepositoryFactory(),
            );
        }
        return this.serverStatsService;
    }
    
    getInitApiValidator() {
        if (this.initApiValidator == null) {
            this.initApiValidator = new InitApiValidator();
        }
        return this.initApiValidator;
    }
    
    getManagerApiValidator() {
        if (this.managerApiValidator == null) {
            this.managerApiValidator = new ManagerApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managerApiValidator;
    }
    
    getManagementContextApiValidator() {
        if (this.managementContextApiValidator == null) {
            this.managementContextApiValidator = new ManagementContextApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementContextApiValidator;
    }
    
    getManagementSolutionApiValidator() {
        if (this.managementSolutionApiValidator == null) {
            this.managementSolutionApiValidator = new ManagementSolutionApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementSolutionApiValidator;
    }
    
    getManagementThreadApiValidator() {
        if (this.managementThreadApiValidator == null) {
            this.managementThreadApiValidator = new ManagementThreadApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementThreadApiValidator;
    }
    
    getManagementInboxApiValidator() {
        if (this.managementInboxApiValidator == null) {
            this.managementInboxApiValidator = new ManagementInboxApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementInboxApiValidator;
    }
    
    getManagementStreamApiValidator() {
        if (this.managementStreamApiValidator == null) {
            this.managementStreamApiValidator = new ManagementStreamApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementStreamApiValidator;
    }
    
    getManagementStoreApiValidator() {
        if (this.managementStoreApiValidator == null) {
            this.managementStoreApiValidator = new ManagementStoreApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementStoreApiValidator;
    }
    
    getManagementKvdbApiValidator() {
        if (this.managementKvdbApiValidator == null) {
            this.managementKvdbApiValidator = new ManagementKvdbApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.managementKvdbApiValidator;
    }
    
    getPlainApiResolver() {
        if (this.plainApiResolver == null) {
            this.plainApiResolver = new ApiResolver();
            this.plainApiResolver.registerApiWithPrefix("", InitApi, e => new InitApi(
                e.ioc.getInitApiValidator(),
            ));
            this.plainApiResolver.registerApiWithPrefix("manager/", ManagerApi, e => new ManagerApi(
                e.ioc.getManagerApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.getAuthService(),
                e.ioc.getApiKeyService(),
                e.webSocket,
            ));
            this.plainApiResolver.registerApiWithPrefix("context/", ManagementContextApi, e => new ManagementContextApi(
                e.ioc.getManagementContextApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getContextService(),
            ));
            this.plainApiResolver.registerApiWithPrefix("solution/", ManagementSolutionApi, e => new ManagementSolutionApi(
                e.ioc.getManagementSolutionApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getSolutionService(),
            ));
            this.plainApiResolver.registerApiWithPrefix("thread/", ManagementThreadApi, e => new ManagementThreadApi(
                e.ioc.getManagementThreadApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getThreadService(),
                e.ioc.getManagementThreadConverter(),
            ));
            this.plainApiResolver.registerApiWithPrefix("store/", ManagementStoreApi, e => new ManagementStoreApi(
                e.ioc.getManagementStoreApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getStoreService(),
                e.ioc.getManagementStoreConverter(),
            ));
            this.plainApiResolver.registerApiWithPrefix("stream/", ManagementStreamApi, e => new ManagementStreamApi(
                e.ioc.getManagementStreamApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getStreamService(),
                e.ioc.getManagementStreamConverter(),
            ));
            this.plainApiResolver.registerApiWithPrefix("inbox/", ManagementInboxApi, e => new ManagementInboxApi(
                e.ioc.getManagementInboxApiValidator(),
                e.ioc.getInboxService(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getManagementInboxConverter(),
            ));
            this.plainApiResolver.registerApiWithPrefix("kvdb/", ManagementKvdbApi, e => new ManagementKvdbApi(
                e.ioc.getManagementKvdbApiValidator(),
                e.getAuthorizationDetector(),
                e.getAuthorizationHolder(),
                e.ioc.getKvdbService(),
                e.ioc.getManagementKvdbConverter(),
            ));
            this.getPluginsManager().registerJsonRpcEndpoint(this.plainApiResolver);
        }
        return this.plainApiResolver;
    }
    
    getWebSocketInnerManager() {
        return this.workerRegistry.getWebSocketInnerManager();
    }
    
    getWebSocketConnectionManager() {
        if (this.webSocketConnectionManager == null) {
            this.webSocketConnectionManager = this.getSimpleWebSocketConnectionManager();
        }
        return this.webSocketConnectionManager;
    }
    
    setWebSocketConnectionManager(webSocketConnectionManager: WebSocketConnectionManager) {
        if (this.webSocketConnectionManager) {
            throw new Error("WebSocketConnectionManager already set");
        }
        this.webSocketConnectionManager = webSocketConnectionManager;
    }
    
    getUserStatusManager() {
        if (this.userStatusManager == null) {
            this.userStatusManager = new UserStatusManager(
                this.workerRegistry.getActiveUsersMap(),
                this.workerRegistry.getWorkerCallbacks(),
                this.getRepositoryFactory(),
                this.workerRegistry.getAggregatedNotificationsService(),
                this.getJobService(),
                this.getConfigService(),
            );
        }
        return this.userStatusManager;
    }
    
    getSimpleWebSocketConnectionManager() {
        if (this.simpleWebSocketConnectionManager == null) {
            this.simpleWebSocketConnectionManager = new SimpleWebSocketConnectionManager(
                this.getJobService(),
                this.getWorker2Service(),
                this.getConfigService(),
                this.workerRegistry.getWebSocketInnerManager(),
                this.getUserStatusManager(),
                this.getInstanceHost(),
                this.getRepositoryFactory(),
            );
        }
        return this.simpleWebSocketConnectionManager;
    }
    
    getWebSocketSender() {
        if (this.webSocketSender == null) {
            this.webSocketSender = new WebSocketSender(
                this.getWebSocketConnectionManager(),
            );
        }
        return this.webSocketSender;
    }
    
    getWebSocketPlainSender() {
        if (this.webSocketPlainSender == null) {
            this.webSocketPlainSender = new WebSocketPlainSender(
                this.getWorker2Service(),
                this.getJobService(),
            );
        }
        return this.webSocketPlainSender;
    }
    
    getServerAgent() {
        if (this.serverAgent == null) {
            this.serverAgent = new ServerAgent(
                this.getConfigService(),
            );
        }
        return this.serverAgent;
    }
    
    getClientIpService() {
        if (this.clientIpService == null) {
            this.clientIpService = new ClientIpService(
                this.getConfigService(),
            );
        }
        return this.clientIpService;
    }
    
    getWorker2Service() {
        return this.workerRegistry.getWorker2ServiceClient();
    }
    
    getWebsocketCommunicationManager() {
        return this.workerRegistry.getWebsocketCommunicationManager();
    }
    
    getRepositoryFactory() {
        if (this.repositoryFactory == null) {
            this.repositoryFactory = new RepositoryFactory(
                this.getMongoDbManager(),
                this.getConfigService(),
            );
        }
        return this.repositoryFactory;
    }
    
    getPacketValidator() {
        if (this.packetValidator == null) {
            this.packetValidator = new PacketValidator(
                this.getTypesValidator(),
            );
        }
        return this.packetValidator;
    }
    
    getUserApiValidator() {
        if (this.userApiValidator == null) {
            this.userApiValidator = new UserApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.userApiValidator;
    }
    
    getTicketKeyHolder() {
        if (this.ticketKeyHolder == null) {
            this.ticketKeyHolder = new TicketKeyHolder();
        }
        return this.ticketKeyHolder;
    }
    
    getRequestApiValidator() {
        if (this.requestApiValidator == null) {
            this.requestApiValidator = new RequestApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.requestApiValidator;
    }
    
    getContextApiValidator() {
        if (this.contextApiValidator == null) {
            this.contextApiValidator = new ContextApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.contextApiValidator;
    }
    
    getThreadApiValidator() {
        if (this.threadApiValidator == null) {
            this.threadApiValidator = new ThreadApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.threadApiValidator;
    }
    
    getMetricService() {
        if (this.metricService == null) {
            this.metricService = new MetricService();
        }
        return this.metricService;
    }
    
    getContextNotificationService() {
        if (this.contextNotificationService == null) {
            this.contextNotificationService = new ContextNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getRepositoryFactory(),
            );
        }
        return this.contextNotificationService;
    }
    
    getContextService() {
        if (this.contextService == null) {
            this.contextService = new ContextService(
                this.getRepositoryFactory(),
                this.getPolicyService(),
                this.workerRegistry.getCloudAclChecker(),
                this.getThreadService(),
                this.getStoreService(),
                this.getInboxService(),
                this.getStreamService(),
                this.getContextNotificationService(),
                this.workerRegistry.getActiveUsersMap(),
                this.getInstanceHost(),
                this.workerRegistry.getWorkerCallbacks(),
            );
        }
        return this.contextService;
    }
    
    getPolicyService() {
        if (this.policyService == null) {
            this.policyService = new PolicyService(
            );
        }
        return this.policyService;
    }
    
    getSolutionService() {
        if (this.solutionService == null) {
            this.solutionService = new SolutionService(
                this.getRepositoryFactory(),
            );
        }
        return this.solutionService;
    }
    
    getThreadService() {
        if (this.threadService == null) {
            this.threadService = new ThreadService(
                this.getRepositoryFactory(),
                this.workerRegistry.getActiveUsersMap(),
                this.getInstanceHost(),
                this.getCloudKeyService(),
                this.getThreadNotificationService(),
                this.workerRegistry.getCloudAclChecker(),
                this.getPolicyService(),
                this.getCloudAccessValidator(),
            );
        }
        return this.threadService;
    }
    
    getKvdbService() {
        if (this.kvdbService == null) {
            this.kvdbService = new KvdbService(
                this.getRepositoryFactory(),
                this.getInstanceHost(),
                this.workerRegistry.getActiveUsersMap(),
                this.getCloudKeyService(),
                this.getKvdbNotificationService(),
                this.workerRegistry.getCloudAclChecker(),
                this.getPolicyService(),
                this.getCloudAccessValidator(),
            );
        }
        return this.kvdbService;
    }
    
    getKvdbNotificationService() {
        if (this.kvdbNotificationService == null) {
            this.kvdbNotificationService = new KvdbNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getWebSocketPlainSender(),
                this.getKvdbConverter(),
                this.getRepositoryFactory(),
                this.getManagementKvdbConverter(),
            );
        }
        return this.kvdbNotificationService;
    }
    
    getKvdbConverter() {
        if (this.kvdbConverter == null) {
            this.kvdbConverter = new KvdbConverter();
        }
        return this.kvdbConverter;
    }
    
    getManagementKvdbConverter() {
        if (this.managementKvdbConverter == null) {
            this.managementKvdbConverter = new ManagementKvdbConverter();
        }
        return this.managementKvdbConverter;
    }
    
    getThreadConverter() {
        if (this.threadConverter == null) {
            this.threadConverter = new ThreadConverter();
        }
        return this.threadConverter;
    }
    
    getCloudKeyService() {
        if (this.cloudKeyService == null) {
            this.cloudKeyService = new CloudKeyService(
                this.getRepositoryFactory(),
            );
        }
        return this.cloudKeyService;
    }
    
    getThreadNotificationService() {
        if (this.threadNotificationService == null) {
            this.threadNotificationService = new ThreadNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getWebSocketPlainSender(),
                this.getThreadConverter(),
                this.getRepositoryFactory(),
                this.getManagementThreadConverter(),
            );
        }
        return this.threadNotificationService;
    }
    
    getStoreApiValidator() {
        if (this.storeApiValidator == null) {
            this.storeApiValidator = new StoreApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.storeApiValidator;
    }
    
    getLockHelper() {
        if (this.lockHelper == null) {
            this.lockHelper = new LockHelper(
                this.workerRegistry.getLockService(),
            );
        }
        return this.lockHelper;
    }
    
    getStoreService() {
        if (this.storeService == null) {
            this.storeService = new StoreService(
                this.getRepositoryFactory(),
                this.getInstanceHost(),
                this.workerRegistry.getActiveUsersMap(),
                this.getCloudKeyService(),
                this.getStoreNotificationService(),
                this.getStorageServiceProvider(),
                this.getJobService(),
                this.createLogger(StoreService),
                this.workerRegistry.getCloudAclChecker(),
                this.getPolicyService(),
                this.getCloudAccessValidator(),
                this.getLockHelper(),
            );
        }
        
        return this.storeService;
    }
    
    getStoreNotificationService() {
        if (this.storeNotificationService == null) {
            this.storeNotificationService = new StoreNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getWebSocketPlainSender(),
                this.getStoreConverter(),
                this.getRepositoryFactory(),
                this.getManagementStoreConverter(),
            );
        }
        return this.storeNotificationService;
    }
    
    getStoreConverter() {
        if (this.storeConverter == null) {
            this.storeConverter = new StoreConverter();
        }
        return this.storeConverter;
    }
    
    getInboxConverter() {
        if (this.inboxConverter == null) {
            this.inboxConverter = new InboxConverter();
        }
        return this.inboxConverter;
    }
    
    getInboxNotificationService() {
        if (this.inboxNotificationService == null) {
            this.inboxNotificationService = new InboxNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getWebSocketPlainSender(),
                this.getInboxConverter(),
                this.getRepositoryFactory(),
                this.getManagementInboxConverter(),
            );
        }
        return this.inboxNotificationService;
    }
    
    getInboxService() {
        if (this.inboxService == null) {
            this.inboxService = new InboxService(
                this.getRepositoryFactory(),
                this.workerRegistry.getActiveUsersMap(),
                this.getInstanceHost(),
                this.getCloudKeyService(),
                this.getInboxNotificationService(),
                this.getStorageServiceProvider(),
                this.getStoreNotificationService(),
                this.getThreadNotificationService(),
                this.workerRegistry.getCloudAclChecker(),
                this.getPolicyService(),
                this.getCloudAccessValidator(),
            );
        }
        return this.inboxService;
    }
    
    getInboxApiValidator() {
        if (this.inboxApiValidator == null) {
            this.inboxApiValidator = new InboxApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.inboxApiValidator;
    }
    
    getStreamConverter() {
        if (this.streamConverter == null) {
            this.streamConverter = new StreamConverter();
        }
        return this.streamConverter;
    }
    
    getStreamNotificationService() {
        if (this.streamNotificationService == null) {
            this.streamNotificationService = new StreamNotificationService(
                this.getJobService(),
                this.getWebSocketSender(),
                this.getWebSocketPlainSender(),
                this.getStreamConverter(),
                this.getRepositoryFactory(),
                this.getManagementStreamConverter(),
            );
        }
        return this.streamNotificationService;
    }
    
    getStreamService() {
        if (this.streamService == null) {
            this.streamService = new StreamService(
                this.getRepositoryFactory(),
                this.getInstanceHost(),
                this.workerRegistry.getActiveUsersMap(),
                this.getCloudKeyService(),
                this.getStreamNotificationService(),
                this.workerRegistry.getCloudAclChecker(),
                this.getPolicyService(),
                this.getCloudAccessValidator(),
            );
        }
        return this.streamService;
    }
    
    getCloudAccessValidator() {
        if (this.cloudAccessValidator == null) {
            this.cloudAccessValidator = new CloudAccessValidator(
                this.getRepositoryFactory(),
            );
        }
        return this.cloudAccessValidator;
    }
    
    getStreamApiValidator() {
        if (this.streamApiValidator == null) {
            this.streamApiValidator = new StreamApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.streamApiValidator;
    }
    
    getKvdbApiValidator() {
        if (this.kvdbApiValidator == null) {
            this.kvdbApiValidator = new KvdbApiValidator(
                this.getTypesValidator(),
            );
        }
        return this.kvdbApiValidator;
    }
    
    getTokenEncryptionService() {
        if (this.tokenEncryptionService == null) {
            this.tokenEncryptionService = new TokenEncryptionService(
                this.getTokenEncryptionKeyProvider(),
            );
        }
        return this.tokenEncryptionService;
    }
    
    getTokenEncryptionKeyProvider() {
        if (this.tokenEncryptionKeyProvider == null) {
            this.tokenEncryptionKeyProvider = new TokenEncryptionKeyProvider(
                this.getRepositoryFactory(),
                this.getConfigService(),
            );
        }
        return this.tokenEncryptionKeyProvider;
    }
    
    getApiKeyService() {
        if (this.apiKeyService == null) {
            this.apiKeyService = new ApiKeyService(
                this.getRepositoryFactory(),
                this.getLockHelper(),
                this.workerRegistry.getConfig(),
            );
        }
        return this.apiKeyService;
    }
    
    getManagementThreadConverter() {
        if (this.managementThreadConverter == null) {
            this.managementThreadConverter = new ManagementThreadConverter();
        }
        return this.managementThreadConverter;
    }
    
    getManagementStreamConverter() {
        if (this.managementStreamConverter == null) {
            this.managementStreamConverter = new ManagementStreamConverter();
        }
        return this.managementStreamConverter;
    }
    
    getManagementStoreConverter() {
        if (this.managementStoreConverter == null) {
            this.managementStoreConverter = new ManagementStoreConverter();
        }
        return this.managementStoreConverter;
    }
    
    getManagementInboxConverter() {
        if (this.managementInboxConverter == null) {
            this.managementInboxConverter = new ManagementInboxConverter();
        }
        return this.managementInboxConverter;
    }
}
