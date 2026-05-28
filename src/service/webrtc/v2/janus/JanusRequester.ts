/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebSocket from "ws";
import * as crypto from "crypto";
import { JanusError } from "./JanusError";
import { PluginHandleId, SessionId } from "../WebRtcTypes";
import { Logger } from "../../../log/Logger";
import { Utils } from "../../../../utils/Utils";
import { Config } from "../../../../cluster/common/ConfigUtils";

type TransactionId = string;

interface PendingRequest<T = unknown> {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
    isSync: boolean;
}

// Internal structures for Type Guards
interface JanusMessage {
    janus: string;
    transaction?: string;
    [key: string]: unknown;
}

interface JanusErrorMsg extends JanusMessage {
    janus: "error";
    error: {
        code: number;
        reason: string;
    };
}

interface JanusPluginErrorMsg extends JanusMessage {
    plugindata: {
        data: {
            error: string;
            error_code: number;
        };
    };
}

export class JanusRequester {
    
    private requests = new Map<TransactionId, PendingRequest>();
    
    constructor(
        private logger: Logger,
        private ws: WebSocket,
        private config: Config,
        private onUnhandledMessage: (notification: unknown) => unknown,
        private onEveryMessage?: (notification: unknown) => unknown,
    ) {
        this.ws.on("message", (data: WebSocket.RawData) => this.handleMessage(data));
        
        this.ws.on("close", () => {
            const error = new Error("Janus WebSocket connection closed");
            for (const req of this.requests.values()) {
                req.reject(error);
            }
            this.requests.clear();
        });
    }
    
    public requestSync<T>(payload: object): Promise<T> {
        return this.sendRequest<T>(payload, true);
    }
    
    public requestAsync<T>(payload: object): Promise<T> {
        return this.sendRequest<T>(payload, false);
    }
    
    public createJanusCall<T>(method: string, body: unknown, sessionId: SessionId, handleId: PluginHandleId): Promise<T> {
        const payload = {
            janus: method,
            session_id: sessionId,
            handle_id: handleId,
            body: body,
        };
        return this.sendRequest<T>(payload, true);
    }
    
    private sendRequest<T>(payload: object, isSync: boolean): Promise<T> {
        const transaction = JanusRequester.generateTransactionId();
        const apisecret = this.config.streams.mediaServer.secret;
        const requestPayload = { ...payload, transaction, apisecret};
        
        return new Promise<T>((resolve, reject) => {
            this.requests.set(transaction, { resolve: resolve as (val: unknown) => void, reject, isSync });
            
            this.logger.debug(requestPayload, "JanusRequester Request");
            
            try {
                this.ws.send(JSON.stringify(requestPayload));
            }
            catch (e) {
                this.requests.delete(transaction);
                reject(e as Error);
            }
        });
    }
    
    private handleMessage(data: WebSocket.RawData) {
        const rawString = JanusRequester.safeWebSocketRawDataToString(data);
        
        if (!rawString) {
            this.logger.error({}, "Received empty or malformed WebSocket data");
            return;
        }
        
        const jsonParseResult = Utils.try(() => JSON.parse(rawString));
        
        if (!jsonParseResult.success) {
            this.logger.error({ error: jsonParseResult.error, sample: rawString.slice(0, 100) }, "Cannot parse Janus message");
            return;
        }
        
        const evt: unknown = jsonParseResult.result;
        if (this.onEveryMessage) {
            this.onEveryMessage(evt);
        }
        
        if (!JanusRequester.isJsonObject(evt)) {
            this.logger.error({ evt }, "Invalid message type received");
            return;
        }
        
        this.logger.debug(evt, "JanusRequester Response");
        
        if (JanusRequester.hasTransaction(evt)) {
            const transactionId = evt.transaction;
            const request = this.requests.get(transactionId);
            
            if (request) {
                this.handleTransactionResponse(evt, transactionId, request);
                return;
            }
        }
        
        try {
            this.onUnhandledMessage(evt);
        }
        catch (e) {
            this.logger.error(e, "Error in onUnhandledMessage handler");
        }
    }
    
    private handleTransactionResponse(evt: JanusMessage, transactionId: string, request: PendingRequest) {
        if (JanusRequester.isJanusError(evt)) {
            this.requests.delete(transactionId);
            const code = evt.error.code || 500;
            const reason = evt.error.reason || "Unknown Janus Error";
            request.reject(new JanusError(code, reason, evt));
            return;
        }
        
        if (JanusRequester.hasPluginError(evt)) {
            this.requests.delete(transactionId);
            const { error_code, error } = evt.plugindata.data;
            request.reject(new JanusError(error_code, error, evt));
            return;
        }
        
        const janusType = evt.janus;
        
        if (janusType === "ack") {
            if (request.isSync) {
                this.requests.delete(transactionId);
                request.resolve(evt);
            }
            else {
                this.logger.debug({ transactionId }, "Received ACK for async request, waiting for Event...");
            }
            return;
        }
        
        if (["success", "event", "webrtcup", "media", "hangup"].includes(janusType)) {
            this.requests.delete(transactionId);
            request.resolve(evt);
            return;
        }
        
        this.logger.warning({ evt }, "Received unknown message type for transaction");
    }
    
    private static safeWebSocketRawDataToString(data: WebSocket.RawData): string | null {
        try {
            if (Buffer.isBuffer(data)) {
                return data.toString("utf8");
            }
            if (Array.isArray(data)) {
                return Buffer.concat(data).toString("utf8");
            }
            if (data instanceof ArrayBuffer) {
                return Buffer.from(data).toString("utf8");
            }
            return null;
        }
        catch {
            return null;
        }
    }
    
    private static generateTransactionId() {
        return crypto.randomBytes(8).toString("hex");
    }
    
    private static isJsonObject(x: unknown): x is Record<string, unknown> {
        return typeof x === "object" && x !== null;
    }
    
    private static hasTransaction(x: Record<string, unknown>): x is JanusMessage & { transaction: string } {
        return typeof x.transaction === "string" && typeof x.janus === "string";
    }
    
    private static isJanusError(x: JanusMessage): x is JanusErrorMsg {
        return x.janus === "error" &&
               typeof x.error === "object" &&
               x.error !== null &&
               typeof (x.error as any).code === "number";
    }
    
    private static hasPluginError(x: JanusMessage): x is JanusPluginErrorMsg {
        if (!("plugindata" in x) || typeof x.plugindata !== "object" || x.plugindata === null) {
            return false;
        }
        const pd = x.plugindata as Record<string, unknown>;
        
        if (!("data" in pd) || typeof pd.data !== "object" || pd.data === null) {
            return false;
        }
        const data = pd.data as Record<string, unknown>;
        
        return typeof data.error === "string" && typeof data.error_code === "number";
    }
}