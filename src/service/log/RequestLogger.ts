/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import { ServerStatsService } from "../misc/ServerStatsService";
import { AppException } from "../../api/AppException";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";
import * as types from "../../types";
import { MetricsContainer } from "../../cluster/master/ipcServices/MetricsContainer";
import { Config } from "../../cluster/common/ConfigUtils";
import { Logger } from "./Logger";

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
    private static readonly MAX_STRING_LENGTH = 100;
    private static readonly MAX_ARRAY_LENGTH = 10;
    private static readonly MAX_BUFFER_LENGTH = 100;
    
    requestId: number;
    startTime: bigint;
    list: {info: MethodInfo, time: number}[];
    logging: boolean;
    requestSize: number;
    responseSize: number;
    currentMethod: MethodInfo|null = null;
    
    private connectionException: any;
    private mainException: any;
    private _hasError = false;
    private _hasInternal = false;
    
    constructor(
        private reqName: string,
        private serverStatsService: ServerStatsService|null,
        private logger: Logger,
        private metricsContainer: MetricsContainer|null,
        private config: Config,
    ) {
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
            methodInfo.success = true;
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
        if (!info.success) {
            this._hasError = true;
        }
    }
    
    setConnectionException(e: any) {
        this.connectionException = e;
        this._hasError = true;
    }
    
    setMainException(e: any) {
        this.mainException = e;
        this._hasError = true;
    }
    
    setLogging(logging: boolean) {
        this.logging = logging;
    }
    
    end() {
        const elpasedTime = MicroTimeUtils.getElapsedTimeInMiliBI(this.startTime);
        setTimeout(() => {
            this.flush(elpasedTime);
        }, 1);
    }
    
    // ==========================
    //          FLUSH
    // ==========================
    
    flush(elpasedTime: number) {
        if (!this.logging && !this._hasError) {
            return;
        }
        
        const logObject: Record<string, any> = {
            name: this.reqName,
            requestId: this.requestId,
            durationMs: elpasedTime,
            frameCount: this.list.length,
            bytesIn: this.requestSize,
            bytesOut: this.responseSize,
        };
        
        const methods = this.list.map(entry => this.formatMethodInfo(entry));
        if (methods.length > 0) {
            logObject.methods = methods;
        }
        
        if (this.connectionException !== undefined) {
            logObject.connectionError = this.formatException(this.connectionException);
        }
        if (this.mainException !== undefined) {
            logObject.mainError = this.formatException(this.mainException);
        }
        
        const message = `${this.reqName} request #${this.requestId} finished in ${elpasedTime}ms`;
        
        if (this._hasInternal) {
            this.logger.error({ request: logObject }, `${this.reqName} request #${this.requestId} caused INTERNAL SERVER ERROR`);
        }
        else if (this._hasError) {
            this.logger.warning({ request: logObject }, message);
        }
        else {
            this.logger.out({ request: logObject }, message);
        }
        
        this.sendMetrics(elpasedTime);
    }
    
    private formatMethodInfo(entry: {info: MethodInfo, time: number}) {
        const { info, time } = entry;
        const methodLog: Record<string, any> = {
            method: info.method || "unknown",
            user: info.user,
            sessionId: info.sessionId,
            success: info.success,
            durationMs: time,
        };
        
        const shouldLogInDetail = this.logger.isLoggingOnThisLevel(Logger.DEBUG) || AppException.is(info.error, "INVALID_PARAMS");
        
        if (shouldLogInDetail) {
            methodLog.params = this.sanitizeData(info.params);
        }
        if (!info.success && info.error) {
            this._hasInternal = AppException.is(info.error, "INTERNAL_ERROR") || !(info.error instanceof AppException);
            if (info.response && this._hasInternal) {
                methodLog.response = this.sanitizeData(info.response.error ?? info.response.result);
            }
            methodLog.error = this.formatException(info.error);
        }
        if (info.outerError !== undefined) {
            methodLog.outerError = this.formatException(info.outerError, info.frameRaw);
        }
        
        return methodLog;
    }
    
    private sanitizeData(data: unknown): unknown {
        if (data === null || typeof data !== "object") {
            if (typeof data === "string" && data.length > RequestLogger.MAX_STRING_LENGTH) {
                return data.substring(0, RequestLogger.MAX_STRING_LENGTH) + `...${data.length - RequestLogger.MAX_STRING_LENGTH} more bytes`;
            }
            return data;
        }
        
        if (data instanceof Buffer) {
            const maxLen = RequestLogger.MAX_BUFFER_LENGTH;
            return data.length > maxLen
                ? `Buffer(${data.length}): ${Hex.from(data.subarray(0, maxLen))}...${data.length - RequestLogger.MAX_BUFFER_LENGTH} more bytes`
                : `Buffer(${data.length}): ${Hex.from(data)}`;
        }
        
        if (Array.isArray(data)) {
            const maxLen = RequestLogger.MAX_ARRAY_LENGTH;
            let itemsToProcess = data;
            let isTruncated = false;
            
            if (data.length > maxLen) {
                itemsToProcess = data.slice(0, maxLen);
                isTruncated = true;
            }
            
            const sanitizedArray = itemsToProcess.map(item => this.sanitizeData(item));
            
            if (isTruncated) {
                sanitizedArray.push(`... and ${data.length - maxLen} more items`);
            }
            
            return sanitizedArray;
        }
        
        const sanitizedObject: { [key: string]: any } = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                sanitizedObject[key] = this.sanitizeData((data as any)[key]);
            }
        }
        return sanitizedObject;
    }
    
    private formatException(e: any, frame?: Buffer): Record<string, any> {
        const errorObject: Record<string, any> = {
            message: e?.message ?? String(e),
            name: e?.name,
        };
        if (e instanceof AppException && e.data) {
            errorObject.data = e.data;
        }
        if (e?.stack) {
            errorObject.stack = e.stack;
        }
        if (frame) {
            errorObject.frameDump = Utils.hexDump(frame);
        }
        return errorObject;
    }
    
    private sendMetrics(elpasedTime: number) {
        if (this.list.length === 0) {
            return;
        }
        
        const errors = this.list.filter(x => !x.info.success && (!x.info.method || !RequestLogger.OMITTED_METHODS.includes(x.info.method))).length;
        if (this.serverStatsService) {
            this.serverStatsService.addRequestInfo(elpasedTime, this.list.length, errors);
        }
        if (this.metricsContainer && this.config.metrics.enabled) {
            const methodWithContext = this.list.find(x => !!x.info.contextId);
            const methodWithSolution = this.list.find(x => !!x.info.solutionId);
            void this.metricsContainer.addMetrics({
                solutionId: (methodWithSolution?.info.solutionId) || "" as types.cloud.SolutionId,
                contextId: (methodWithContext?.info.contextId) || "" as types.context.ContextId,
                errors: errors as types.core.Quantity,
                requests: this.list.length as types.core.Quantity,
                executionTime: elpasedTime as types.core.Timespan,
                inTraffic: this.requestSize as types.core.SizeInBytes,
                outTraffic: this.responseSize as types.core.SizeInBytes,
            });
        }
    }
}