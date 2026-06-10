/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JanusConnection } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";
import { LoggerFactory } from "../log/LoggerFactory";
import { Logger } from "../log/Logger";
import * as WebSocket from "ws";
import { JanusVideoRoomPluginApi } from "../webrtc/v2/janus/videoroom/JanusVideoRoomPluginApi";
import { JanusConnector } from "./JanusConnector";

const JANUS_PLUGIN = "janus.plugin.videoroom";

interface AdminContext {
    connection: JanusConnection;
    sessionId: WebRtcTypes.SessionId;
    handleId: WebRtcTypes.VideoRoomPluginHandleId;
}

/** The single persistent "admin" Janus session for bridge-initiated calls (`withJanus`), kept separate from per-ws contexts. */
export class AdminJanusConnection {
    
    private logger: Logger;
    private adminContext: AdminContext | null = null;
    private adminContextPromise: Promise<AdminContext> | null = null;
    private adminKeepAliveInterval: NodeJS.Timeout | null = null;
    private opChain: Promise<unknown> = Promise.resolve();
    
    constructor(
        private loggerFactory: LoggerFactory,
        private connector: JanusConnector,
    ) {
        this.logger = this.loggerFactory.createLogger(AdminJanusConnection);
    }
    
    /**
     * Serializes admin tasks: there is a single shared admin session+handle, and some tasks
     * (e.g. listing a room's publishers) join/leave a videoroom on it — running two concurrently
     * would corrupt that one handle's state.
     */
    async withJanus<T>(func: (videoApi: JanusVideoRoomPluginApi, sessionId: WebRtcTypes.SessionId, handleId: WebRtcTypes.VideoRoomPluginHandleId) => Promise<T>): Promise<T> {
        const run = this.opChain.then(() => this.runWithJanus(func), () => this.runWithJanus(func));
        this.opChain = run.then(() => undefined, () => undefined);
        return run;
    }
    
    private async runWithJanus<T>(func: (videoApi: JanusVideoRoomPluginApi, sessionId: WebRtcTypes.SessionId, handleId: WebRtcTypes.VideoRoomPluginHandleId) => Promise<T>): Promise<T> {
        try {
            const ctx = await this.getAdminContext();
            return await func(ctx.connection.janusVideoRoomPluginApi, ctx.sessionId, ctx.handleId);
        }
        catch (e) {
            this.logger.error(e, "Error during request to media server (Admin Task)");
            this.destroyAdminContext();
            throw new AppException("ERROR_DURING_REQUEST_TO_MEDIA_SERVER");
        }
    }
    
    private async getAdminContext(): Promise<AdminContext> {
        if (this.adminContext && !this.adminContext.connection.janusWs.CLOSED && this.adminContext.connection.janusWs.readyState === WebSocket.OPEN) {
            return this.adminContext;
        }
        // Guard against the cold-start race: concurrent callers share one in-flight
        // creation instead of each opening (and leaking) its own admin connection.
        if (!this.adminContextPromise) {
            this.adminContextPromise = this.createAdminContext().finally(() => {
                this.adminContextPromise = null;
            });
        }
        return this.adminContextPromise;
    }
    
    private async createAdminContext(): Promise<AdminContext> {
        this.destroyAdminContext();
        
        this.logger.out("Opening new persistent Admin Janus Connection...");
        const connection = await this.connector.openWs();
        
        try {
            const createSessionResponse = await connection.janusApi.create({ janus: "create" });
            const sessionId = createSessionResponse.data.id;
            
            const attachResponse = await connection.janusApi.attach({ janus: "attach", session_id: sessionId, plugin: JANUS_PLUGIN });
            const handleId = attachResponse.data.id as WebRtcTypes.VideoRoomPluginHandleId;
            
            this.adminContext = { connection, sessionId, handleId };
            
            this.adminKeepAliveInterval = setInterval(() => {
                connection.janusApi.keepAlive({ janus: "keepalive", session_id: sessionId })
                    .catch(err => {
                        this.logger.error(err, "Admin KeepAlive failed. Resetting context.");
                        this.destroyAdminContext();
                    });
            }, 30000);
            
            connection.janusWs.addEventListener("close", () => {
                this.logger.warning({}, "Admin Janus Connection closed unexpectedly.");
                this.destroyAdminContext();
            });
            
            return this.adminContext;
        }
        catch (error) {
            connection.janusWs.close();
            throw error;
        }
    }
    
    private destroyAdminContext() {
        if (this.adminKeepAliveInterval) {
            clearInterval(this.adminKeepAliveInterval);
            this.adminKeepAliveInterval = null;
        }
        if (this.adminContext) {
            const { connection, sessionId } = this.adminContext;
            // Cheap explicit destroy so Janus reclaims the session immediately instead of
            // waiting for a keepalive timeout; then close the ws.
            void connection.janusApi.destroy({ janus: "destroy", session_id: sessionId }).catch(() => { /* ignore */ });
            try {
                connection.janusWs.close();
            }
            catch { /* ignore */ }
            this.adminContext = null;
        }
    }
}
