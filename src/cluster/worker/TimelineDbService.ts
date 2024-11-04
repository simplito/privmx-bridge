/* eslint-disable max-classes-per-file */
import * as TimelineDb from "privmx-timeline-db";
import { Config } from "../common/ConfigUtils";
import { WebSocketClient } from "../../utils/WebSocketClient";
import { Logger } from "../../service/log/LoggerFactory";
import * as types from "../../types";

export interface ApiUsageModel {
    instanceId: types.core.Host;
    contextId: types.context.ContextId;
    solutionId: types.cloud.SolutionId;
    requests: number;
    errors: number;
    executionTime: number;
    inTraffic: number;
    outTraffic: number;
}

export class TimelineDbService {
    
    private ws: WebSocketClient;
    private mainApi: TimelineDbMainApiClient;
    
    constructor(
        private config: Config,
        private logger: Logger,
    ) {
        this.ws = new WebSocketClient({
            get enabled() {
                return config.timelineDb.enabled;
            },
            get url() {
                return config.timelineDb.url;
            },
            get auth() {
                return config.timelineDb.clientId + ":" + config.timelineDb.clientSecret;
            },
        }, this.logger, x => this.onNotification(x));
        this.mainApi = new TimelineDbMainApiClient((method, params) => this.ws.send(method, params));
    }
    
    async connect() {
        return this.ws.connect();
    }
    
    async close() {
        return this.ws.close();
    }
    
    async addApiUsage(model: ApiUsageModel) {
        if (!this.config.timelineDb.enabled) {
            return "OK";
        }
        return this.mainApi.addApiUsage({
            instanceId: model.instanceId as string as TimelineDb.main.InstanceId,
            solutionId: model.solutionId,
            contextId: model.contextId,
            requests: model.requests as TimelineDb.core.Quantity,
            errors: model.errors as TimelineDb.core.Quantity,
            executionTime: model.executionTime as TimelineDb.core.Timespan,
            inTraffic: model.inTraffic as TimelineDb.core.SizeInBytes,
            outTraffic: model.outTraffic as TimelineDb.core.SizeInBytes,
        });
    }
    
    addApiUsageSafe(model: ApiUsageModel) {
        void (async () => {
            try {
                await this.addApiUsage(model);
            }
            catch (e) {
                this.logger.error("Error during adding api usage", e);
            }
        })();
    }
    
    async getApiUsage(model: TimelineDb.main.GetApiUsageModel) {
        if (!this.config.timelineDb.enabled) {
            throw new Error("Timeline DB is disabled");
        }
        return this.mainApi.getApiUsage(model);
    }
    
    private onNotification(_data: unknown) {
        // Do nothing
    }
}

class TimelineDbMainApiClient implements TimelineDb.main.IMainApi {
    
    constructor(
        private request: <T>(method: string, params: unknown) => Promise<T>,
    ) {
    }
    
    ping(): Promise<"pong"> {
        return this.request("main/ping", {});
    }
    
    authorizeWebsocket(model: TimelineDb.main.AuthrorizeWebsocketModel): Promise<TimelineDb.core.OK> {
        return this.request("main/authorizeWebsocket", model);
    }
    
    addApiUsage(model: TimelineDb.main.AddApiUsageModel): Promise<TimelineDb.core.OK> {
        return this.request("main/addApiUsage", model);
    }
    
    getApiUsage(model: TimelineDb.main.GetApiUsageModel): Promise<TimelineDb.main.GetApiUsageResult> {
        return this.request("main/getApiUsage", model);
    }
}
