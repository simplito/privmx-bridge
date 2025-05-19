/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PrivmxConnectionServer } from "./tls/PrivmxConnectionServer";
import { Logger, LoggerFactory, LowLogger } from "../service/log/LoggerFactory";
import { SrpLoginService } from "../service/login/SrpLoginService";
import { ConfigService } from "../service/config/ConfigService";
import { KeyLoginService } from "../service/login/KeyLoginService";
import { SessionHolder } from "./session/SessionHolder";
import { Callbacks } from "../service/event/Callbacks";
import { AppException, ERROR_CODES } from "./AppException";
import { RequestScopeIOC } from "../service/ioc/RequestScopeIOC";
import { Raw } from "./server/Raw";
import { ContentType } from "./tls/ContentType";
import { OutputBufferStream } from "../utils/OutputBufferStream";
import { InputBufferStream } from "../utils/InputBufferStream";
import { SessionService } from "./session/SessionService";
import { TicketsDb } from "./tls/TicketsDb";
import * as types from "../types";
import { RequestInfoHolder } from "./session/RequestInfoHolder";
import { RequestLogger, MethodInfo } from "../service/log/RequestLogger";
import { AccessDeniedError } from "./session/AccessDeniedError";
import { MaintenanceService } from "../service/misc/MaintenanceService";
import { EcdheLoginService } from "../service/login/EcdheLoginService";
import { ServerAgent } from "./ServerAgent";
import { SessionLoginService } from "../service/login/SessionLoginService";
import { RpcError } from "./tls/RpcError";
import { Utils } from "../utils/Utils";
import { PkiFactory } from "../service/pki/PkiFactory";
import { PacketValidator } from "./tls/PacketValidator";
import { MicroTimeUtils } from "../utils/MicroTimeUtils";
import { ApiResolver } from "./ApiResolver";
import { ServerSignatureService } from "../service/cloud/ServerSignatureService";

export interface Context {
    ioc: RequestScopeIOC;
    sessionService: SessionService;
}

export type MainApiResolver = ApiResolver<Context>;
export type RequestApiResolver = ApiResolver<RequestScopeIOC>;

export class ServerEndpoint {
    
    connection: PrivmxConnectionServer;
    private lowLogger!: LowLogger;
    
    constructor(
        private requestLogger: RequestLogger,
        private srpLoginService: SrpLoginService,
        private configService: ConfigService,
        private ticketsDb: TicketsDb,
        private keyLoginService: KeyLoginService,
        private packetValidator: PacketValidator,
        private sessionHolder: SessionHolder,
        private pkiFactory: PkiFactory,
        private callbacks: Callbacks,
        private mainApiResolver: MainApiResolver,
        private requestScopeIoc: RequestScopeIOC,
        private requestInfoHolder: RequestInfoHolder,
        private maintenanceService: MaintenanceService,
        private ecdheLoginService: EcdheLoginService,
        private sessionLoginService: SessionLoginService,
        private serverAgent: ServerAgent,
        private logger: Logger,
        private loggerFactory: LoggerFactory,
        private serverSignatureService: ServerSignatureService,
    ) {
        this.connection = new PrivmxConnectionServer(this.requestLogger, this.ticketsDb, this.serverAgent, this.packetValidator, this.srpLoginService, this.keyLoginService,
            this.ecdheLoginService, this.sessionLoginService, () => this.pkiFactory.loadKeystore(), this.configService, this.sessionValidator.bind(this), this.serverSignatureService, this.loggerFactory.get(PrivmxConnectionServer));
        this.connection.setOutputStream(new OutputBufferStream());
        this.connection.setAppFrameHandler(this.__invoke.bind(this));
    }
    
    getConnection(): PrivmxConnectionServer {
        return this.connection;
    }
    
    async callMethod(requestScopeIoc: RequestScopeIOC, sessionService: SessionService, method: string, params: any): Promise<any> {
        return this.mainApiResolver.execute({ioc: requestScopeIoc, sessionService}, method, params);
    }
    
    async handleFrame(sessionService: SessionService, frame: {id: string, method: string, params: any}) {
        const response = <{id: string, jsonrpc: string, result?: any, error?: types.core.ApiError}>{id: frame.id, jsonrpc: "2.0"};
        let error: any;
        let success = true;
        try {
            const method = frame.method;
            const params = frame.params;
            const result = await this.callMethod(this.requestScopeIoc, sessionService, method, params);
            this.lowLogger.log("Called");
            if (result instanceof Raw) {
                const data = result.getData();
                const binary = result.isBinary();
                if (binary) {
                    response.result = data;
                }
                else if (typeof data === "string") {
                    response.result = JSON.parse(data);
                }
                else {
                    throw new Error("Data is not a string or binary");
                }
            }
            else {
                response.result = result;
            }
            response.error = undefined;
        }
        catch (e) {
            success = false;
            error = e;
            if (e instanceof AppException) {
                response.error = {
                    data: {
                        error: {
                            code: e.getCode(),
                            data: e.getData(),
                        },
                    },
                    msg: e.message || "<unknown>",
                };
                response.result = null;
            }
            else if (e instanceof AccessDeniedError) {
                response.error = {
                    data: {
                        error: {
                            code: ERROR_CODES.INTERNAL_ERROR.code,
                        },
                    },
                    msg: e.message + " for method '" + frame.method + "'",
                };
                response.result = null;
            }
            else {
                response.error = {
                    data: {
                        error: {
                            code: ERROR_CODES.INTERNAL_ERROR.code,
                        },
                    },
                    msg: this.getInternalServerErrorMessage(e),
                };
                response.result = null;
            }
        }
        this.lowLogger.log("Handle Frame end");
        return {
            response: response,
            success: success,
            error: error,
        };
    }
    
    async __invoke(conn: PrivmxConnectionServer, frameData: Buffer) {
        const startTime = MicroTimeUtils.nowBI();
        const methodInfo: MethodInfo = {
            frameRaw: frameData,
        };
        this.requestLogger.setCurrentMethod(methodInfo);
        this.lowLogger.log("Server Endpoint Invoke start");
        try {
            const sessionId = this.connection.getSessionId();
            const session = sessionId ? await this.sessionHolder.restoreSession(sessionId) : null;
            const sessionService = new SessionService(session, this.maintenanceService, this.loggerFactory.get(SessionService));
            methodInfo.sessionId = session ? session.id : "";
            methodInfo.user = session ? session.get("username") || "" : "";
            if (session) {
                methodInfo.solutionId = session.get("solution");
            }
            this.lowLogger.log("Server Endpoint SessionService");
            const frameResult = Utils.try(() => <{id_: any, id: any, method: string, params: any}>conn.psonHelper.pson_decodeEx(frameData));
            if (frameResult.success === false) {
                methodInfo.error = frameResult.error;
                throw new RpcError("Invalid application frame data. Cannot decode given PSON");
            }
            const frame = frameResult.result;
            this.lowLogger.log("Server Endpoint Refresh Decode frame");
            methodInfo.frame = frame;
            methodInfo.id = frame ? frame.id : null;
            methodInfo.method = frame ? frame.method || "" : "";
            methodInfo.params = frame ? frame.params : null;
            if (frame.id == null) {
                throw new RpcError("Invalid frame. Field 'id' required");
            }
            if (frame.method == null) {
                throw new RpcError("Invalid frame. Field 'method' required");
            }
            if (frame.params == null) {
                throw new RpcError("Invalid frame. Field 'params' required");
            }
            frame.id_ = typeof(frame.id) == "string" ? frame.id.substr(-4) : frame.id;
            this.lowLogger.log("Server Endpoint Prepare frame");
            const response = await this.handleFrame(sessionService, frame);
            methodInfo.response = response.response;
            methodInfo.success = response.success;
            methodInfo.error = response.error;
            this.lowLogger.log("Server Endpoint Handle frame");
            const encoded = conn.psonHelper.pson_encode(response.response);
            this.lowLogger.log("Server Endpoint Encode");
            conn.send(encoded);
            this.lowLogger.log("Server Endpoint Send");
        }
        catch (e) {
            methodInfo.outerError = e;
            conn.send(this.getMessageBufferForInternalServerError(e), ContentType.ALERT);
        }
        finally {
            this.requestLogger.add(startTime, methodInfo);
            this.requestLogger.clearCurrentMethod();
        }
        this.lowLogger.log("Server Endpoint Invoke end");
    }
    
    async sessionValidator(sessionId: types.core.SessionId|undefined): Promise<boolean> {
        if (!sessionId) {
            return true;
        }
        const restoreResult = await Utils.tryPromise(() => this.sessionHolder.restoreSession(sessionId));
        if (restoreResult.success === false) {
            // Error during restoring session
            return false;
        }
        const session = restoreResult.result;
        if (session == null) {
            // No session assigned to ticket
            return false;
        }
        const proxy = session.get("proxy");
        if (proxy == null) {
            // Session is normal without required additional auth header
            return true;
        }
        if (this.requestInfoHolder.serverSession == null || proxy != this.requestInfoHolder.serverSession.host) {
            // Server session does not match to user session
            return false;
        }
        return true;
    }
    
    private getMessageBufferForInternalServerError(e: any): Buffer {
        return Buffer.from(this.getInternalServerErrorMessage(e));
    }
    
    private getInternalServerErrorMessage(e: any): string {
        if (e instanceof RpcError || e instanceof AppException || e instanceof AccessDeniedError) {
            return e.message || "<unknown>";
        }
        return "Internal server error";
    }
    
    async execute(request: Buffer): Promise<Buffer> {
        this.lowLogger = this.logger.createLow();
        // this.lock.reader();
        
        this.lowLogger.log("Processing request");
        try {
            await this.connection.process(new InputBufferStream(request));
        }
        catch (e) {
            this.requestLogger.setConnectionException(e);
            this.connection.send(this.getMessageBufferForInternalServerError(e), ContentType.ALERT);
        }
        if (!this.connection.output) {
            throw new Error("No connection output");
        }
        const result = this.connection.output.getContentsAndClear();
        
        // this.lock.release();
        
        await this.callbacks.trigger("afterRequest", []);
        await this.sessionHolder.close(undefined);
        this.lowLogger.log("Server Endpoint Execute");
        this.lowLogger.flushLogInNextTick();
        
        return result;
    }
    
    async executeLite(request: Buffer): Promise<Buffer> {
        this.lowLogger = this.logger.createLow();
        
        this.lowLogger.log("Processing request");
        try {
            await this.connection.process(new InputBufferStream(request));
        }
        catch (e) {
            this.requestLogger.setConnectionException(e);
            this.connection.send(this.getMessageBufferForInternalServerError(e), ContentType.ALERT);
        }
        if (!this.connection.output) {
            throw new Error("No connection output");
        }
        const result = this.connection.output.getContentsAndClear();
        
        await this.callbacks.trigger("afterRequest", []);
        await this.sessionHolder.close(undefined);
        this.lowLogger.log("Server Endpoint Execute");
        this.lowLogger.flushLogInNextTick();
        
        return result;
    }
    
    async executeMethod(method: string, params: any, sessionId: types.core.SessionId): Promise<any> {
        this.lowLogger = this.logger.createLow();
        this.lowLogger.log("Processing method");
        try {
            const session = sessionId ? await this.sessionHolder.restoreSession(sessionId) : null;
            const sessionService = new SessionService(session, this.maintenanceService, this.loggerFactory.get(SessionService));
            return await this.callMethod(this.requestScopeIoc, sessionService, method, params);
        }
        finally {
            await this.sessionHolder.close(undefined);
            this.lowLogger.log("Server Endpoint Execute Method");
            this.lowLogger.flushLogInNextTick();
        }
    }
}
