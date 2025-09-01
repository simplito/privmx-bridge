/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ILogBuilder, ILogFactory, Logger } from "./LoggerFactory";
import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import { ServerStatsService } from "../misc/ServerStatsService";
import type * as Cluster from "cluster";
import { AppException } from "../../api/AppException";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";
import * as types from "../../types";
import { MetricsContainer } from "../../cluster/master/ipcServices/MetricsContainer";
import { Config } from "../../cluster/common/ConfigUtils";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

export interface MethodInfo {
    // session
    user?: string;
    sessionId?: string;
    
    // input
    id?: string;
    method?: string;
    params?: unknown;
    contextId?: types.context.ContextId;
    solutionId?: types.cloud.SolutionId;
    
    frame?: unknown;
    frameRaw?: Buffer;
    
    // output
    success?: boolean;
    response?: {error?: unknown, result?: unknown};
    error?: unknown;
    outerError?: unknown;
}

export class RequestLogger {
    
    static REQUEST_ID = 0;
    static OMITTED_METHODS = ["srp_init", "srp_exchange", "key_init", "key_exchange"];
    level: number;
    requestId: number;
    startDate: number;
    startTime: bigint;
    list: {info: MethodInfo, time: number}[];
    connectionException: any;
    mainException: any;
    logging: boolean;
    requestSize: number;
    responseSize: number;
    currentMethod: MethodInfo|null = null;
    
    constructor(
        private reqName: string,
        private serverStatsService: ServerStatsService|null,
        private logFactory: ILogFactory,
        private metricsContainer: MetricsContainer|null,
        private config: Config,
    ) {
        this.level = Logger.WARNING;
        this.startDate = Date.now();
        this.startTime = process.hrtime.bigint();
        this.requestId = RequestLogger.REQUEST_ID++;
        this.list = [];
        this.logging = true;
        this.requestSize = 0;
        this.responseSize = 0;
    }
    
    setRequestSize(requestSize: number) {
        this.requestSize = requestSize;
    }
    
    setResponsSize(responseSize: number) {
        this.responseSize = responseSize;
    }
    
    setCurrentMethod(info: MethodInfo) {
        this.currentMethod = info;
    }
    
    clearCurrentMethod() {
        this.currentMethod = null;
    }
    
    setContextId(contextId: types.context.ContextId) {
        if (this.currentMethod) {
            this.currentMethod.contextId = contextId;
        }
    }
    
    setSolutionId(solutionId: types.cloud.SolutionId) {
        if (this.currentMethod) {
            this.currentMethod.solutionId = solutionId;
        }
    }
    
    async runWith<T>(func: (methodInfo: MethodInfo) => Promise<T>) {
        const startTime = MicroTimeUtils.nowBI();
        const methodInfo: MethodInfo = {};
        try {
            return await func(methodInfo);
        }
        catch (e) {
            methodInfo.success = false;
            methodInfo.error = e;
            throw e;
        }
        finally {
            this.add(startTime, methodInfo);
        }
    }
    
    add(startTime: bigint, info: MethodInfo) {
        this.list.push({info: info, time: MicroTimeUtils.getElapsedTimeInMiliBI(startTime)});
    }
    
    setConnectionException(e: any) {
        this.connectionException = e;
    }
    
    setMainException(e: any) {
        this.mainException = e;
    }
    
    setLogging(logging: boolean) {
        this.logging = logging;
    }
    
    end() {
        setTimeout(() => {
            this.flush();
        }, 1);
    }
    
    // ==========================
    //          FLUSH
    // ==========================
    
    flush() {
        if (!this.logging && !this.hasError()) {
            return;
        }
        const builder = this.logFactory.createBuilder();
        const elpasedTime = MicroTimeUtils.getElapsedTimeInMiliBI(this.startTime);
        const prefix = this.getPrefix(elpasedTime);
        if (this.list.length == 0) {
            builder.addLine(prefix);
        }
        else if (this.list.length == 1) {
            const entry = this.list[0];
            builder.addLine(prefix + " " + this.getMethodInfo(entry));
            this.logMethodInfo(builder, entry.info);
        }
        else {
            const username = this.getUsernameIfOneUserCallAllMethods();
            builder.addLine(prefix + (username ? "[u=" + username + "]" : ""));
            for (const entry of this.list) {
                builder.addLine("--" + this.getMethodInfo(entry));
                this.logMethodInfo(builder, entry.info);
            }
        }
        if (typeof(this.connectionException) != "undefined") {
            this.logException(builder, "Connection error", this.connectionException);
        }
        if (typeof(this.mainException) != "undefined") {
            this.logException(builder, "Main error", this.mainException);
        }
        builder.flush();
        if (this.list.length) {
            const errors = this.list.filter(x => x.info.error && (!x.info.method || !RequestLogger.OMITTED_METHODS.includes(x.info.method))).length;
            if (this.serverStatsService) {
                this.serverStatsService.addRequestInfo(elpasedTime, this.list.length, errors);
            }
            if (this.metricsContainer && this.config.metrics.enabled) {
                const methodWithContext = this.list.find(x => !!x.info.contextId);
                const methodWithSolution = this.list.find(x => !!x.info.solutionId);
                void this.metricsContainer.addMetrics({
                    solutionId: (methodWithSolution ? methodWithSolution.info.solutionId : null) || "" as types.cloud.SolutionId,
                    contextId: (methodWithContext ? methodWithContext.info.contextId : null) || "" as types.context.ContextId,
                    errors: errors as types.core.Quantity,
                    requests: this.list.length as types.core.Quantity,
                    executionTime: elpasedTime as types.core.Timespan,
                    inTraffic: this.requestSize as types.core.SizeInBytes,
                    outTraffic: this.responseSize as types.core.SizeInBytes,
                });
            }
        }
    }
    
    private hasError(): boolean {
        for (const entry of this.list) {
            if (!entry.info.success) {
                return true;
            }
        }
        return typeof(this.connectionException) != "undefined" || typeof(this.mainException) != "undefined";
    }
    
    private getPrefix(elpasedTime: number) {
        return "[" + new Date(this.startDate).toISOString() + "][" + `${cluster.isPrimary ? "MS" : `${cluster.worker?.id.toString().padStart(2, "0")}`},P:${process.pid}` + "][" + this.reqName + "][id=" + this.requestId + "][t=" + elpasedTime + "][f=" + this.list.length + "][i=" + this.requestSize + "][o=" + this.responseSize + "]";
    }
    
    private getMethodInfo(entry: {info: MethodInfo, time: number}) {
        return entry.info.method + ";" + entry.info.sessionId + ";" + entry.info.user + ";" + (entry.info.success ? "ok" : "fail") + ";" + entry.time;
    }
    
    private logMethodInfo(builder: ILogBuilder, info: MethodInfo) {
        if (this.level <= Logger.DEBUG) {
            builder.addLine("--received", info.frame);
        }
        if (this.level <= Logger.INFO || AppException.is(info.error, "INVALID_PARAMS")) {
            builder.addLine("--frame params", this.prepareDataToLog(info.params));
        }
        if (info.response && this.level <= Logger.INFO) {
            builder.addLine("--frame response data", this.prepareDataToLog(info.response.error == null ? info.response.result : info.response.error));
        }
        if (!info.success) {
            this.logException(builder, "Error", info.error);
        }
        if (typeof(info.outerError) != "undefined") {
            this.logException(builder, "Outer error", info.outerError, info.frameRaw);
        }
    }
    
    private prepareDataToLog(data: any) {
        if (this.level > Logger.INFO) {
            return {};
        }
        const res = this.prepareDataToLogCore(data);
        return {_: res && res.length > 1024 ? res.substr(0, 1024) + "..." : res};
    }
    
    private prepareDataToLogCore(data: any): string {
        if (data instanceof Buffer) {
            return data.length > 500 ? Hex.from(data.slice(0, 500)) + "..." : Hex.from(data);
        }
        if (typeof(data) == "string") {
            return data;
        }
        let json: string;
        try {
            json = JSON.stringify(data);
        }
        catch {
            json = "cannot-encode-json-exception";
        }
        return json;
    }
    
    private logException(builder: ILogBuilder, info: string, e: any, frame?: Buffer): void {
        builder.addLine("--" + info + " - " + (e && e.message ? e.message : e) + this.tryExtractAdditionalErrorFields(e));
        builder.addLine("--Trace:", e);
        if (frame != null) {
            builder.addLine("--Frame:\n" + Utils.hexDump(frame));
        }
    }
    
    private getUsernameIfOneUserCallAllMethods() {
        if (this.list.length == 0 || !this.list[0].info || !this.list[0].info.user) {
            return null;
        }
        const user = this.list[0].info.user;
        return this.list.some(x => !x.info || x.info.user != user) ? null : user;
    }
    
    private tryExtractAdditionalErrorFields(e: unknown) {
        if (e instanceof AppException && e.data) {
            try {
                return " {data: " + this.valueToString(e.data) + "}";
            }
            catch {
                return " <cannot-serialize-error-data>";
            }
        }
        return "";
    }
    
    private valueToString(e: unknown, level = 0): string {
        if (typeof(e) === "object") {
            if (e === null) {
                return "null";
            }
            if (level >= 1) {
                return "<object>";
            }
            if (Array.isArray(e)) {
                return JSON.stringify(e.map(x => this.valueToString(x, level + 1)));
            }
            const obj: {[key: string]: unknown} = {};
            for (const key in e) {
                obj[key] = this.valueToString((e as any)[key], level + 1);
            }
            return JSON.stringify(obj);
        }
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return "" + e;
    }
}
