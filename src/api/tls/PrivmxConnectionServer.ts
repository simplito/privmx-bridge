/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { KeyLoginService } from "../../service/login/KeyLoginService";
import { SrpLoginService } from "../../service/login/SrpLoginService";
import { RWState } from "./RWState";
import { ContentType } from "./ContentType";
import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import * as elliptic from "elliptic";
import * as pki from "privmx-pki2";
import { TicketsDb, TicketData, TicketId } from "./TicketsDb";
import { PrivmxConnectionBase } from "./PrivmxConnectionBase";
import * as ByteBuffer from "bytebuffer";
import * as types from "../../types";
import { RequestLogger } from "../../service/log/RequestLogger";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { EcdheLoginService } from "../../service/login/EcdheLoginService";
import { ServerAgent } from "../ServerAgent";
import { SessionLoginService } from "../../service/login/SessionLoginService";
import { RpcError } from "./RpcError";
import { Whenable } from "../../CommonTypes";
import { PacketValidator } from "./PacketValidator";
import { ConfigService } from "../../service/config/ConfigService";
import { DateUtils } from "../../utils/DateUtils";
import { Crypto } from "../../utils/crypto/Crypto";
import { Logger } from "../../service/log/LoggerFactory";

export class PrivmxConnectionServer extends PrivmxConnectionBase {
    
    sessionId: types.core.SessionId;
    clientAgent: types.core.UserAgent;
    sessionValidator: (sessionId: types.core.SessionId) => Whenable<boolean> = null;
    
    constructor(
        private requestLogger: RequestLogger,
        private ticketsDb: TicketsDb,
        private serverAgent: ServerAgent,
        private validators: PacketValidator = null,
        private srpLoginService: SrpLoginService = null,
        private keyLoginService: KeyLoginService = null,
        private ecdheLoginService: EcdheLoginService = null,
        private sessionLoginService: SessionLoginService = null,
        private serverKeystoreProvider: () => Promise<pki.common.Types.keystore.IKeyStore2>,
        private configService: ConfigService,
        logger: Logger,
    ) {
        super(!configService.values.application.allowUnauthorized, logger);
        this.sessionId = null;
        this.clientAgent = null;
    }
    
    private getServerConfig() {
        const config: types.packet.ServerConfig = {
            requestChunkSize: this.configService.values.request.chunkSize,
        };
        return config;
    }
    
    async processHandshakePacket(raw: types.packet.BasePacket): Promise<void> {
        if (raw.type == "ecdhe") {
            const packet = <types.packet.EcdheRequestPacket>raw;
            this.validators.validate("handshake_ecdhe", packet);
            const ec = elliptic.ec("secp256k1");
            const ecKey = ec.genKeyPair();
            const response: types.packet.EcdheResponsePacket = {
                type: "ecdhe",
                key: ByteBuffer.wrap(Buffer.from(ecKey.getPublic(true, "binary"))),
                agent: this.getServerAgent(),
                config: this.getServerConfig(),
            };
            const pson = this.psonHelper.pson_encode(response);
            this.send(pson, ContentType.HANDSHAKE);
            if (packet.agent != null) {
                this.clientAgent = packet.agent;
            }
            const clientKey = ec.keyFromPublic(packet.key.toBuffer());
            const sessionId = await this.ecdheLoginService.onLogin(ECUtils.publicToBase58DER(clientKey), packet.solution);
            this.sessionId = sessionId;
            const der = Buffer.from(ecKey.derive(clientKey.getPublic()).toString("hex", 2), "hex");
            const z = Utils.fillTo32(der);
            this.setPreMasterSecret(z);
            this.changeWriteCipherSpec();
        }
        else if (raw.type == "ecdhex") {
            const packet = <types.packet.EcdhexRequestPacket>raw;
            this.validators.validate("handshake_ecdhex", packet);
            const ec = elliptic.ec("secp256k1");
            const ecKey = ec.genKeyPair();
            const response: types.packet.EcdhexResponsePacket = {
                type: "ecdhex",
                key: ByteBuffer.wrap(Buffer.from(ecKey.getPublic(true, "binary"))),
                agent: this.getServerAgent(),
                config: this.getServerConfig(),
                host: this.configService.getMainHost(),
            };
            const pson = this.psonHelper.pson_encode(response);
            this.send(pson, ContentType.HANDSHAKE);
            if (packet.agent != null) {
                this.clientAgent = packet.agent;
            }
            const clientKey = ec.keyFromPublic(packet.key.toBuffer());
            const sessionId = await this.ecdheLoginService.onLoginX(ECUtils.publicToBase58DER(clientKey), packet.nonce, DateUtils.convertStrToTimestamp(packet.timestamp), packet.signature, packet.solution);
            this.sessionId = sessionId;
            const der = Buffer.from(ecKey.derive(clientKey.getPublic()).toString("hex", 2), "hex");
            const z = Utils.fillTo32(der);
            this.setPreMasterSecret(z);
            if (!packet.plain) {
                this.changeWriteCipherSpec();
            }
        }
        else if (raw.type == "session") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.SessionRequestPacket>raw;
                this.validators.validate("handshake_frame_session", packet);
                methodInfo.sessionId = packet.sessionId;
                methodInfo.method = "session";
                methodInfo.params = packet;
                const ec = elliptic.ec("secp256k1");
                const clientKey = ECUtils.publicFromBase58DER(packet.sessionKey);
                const session = await this.sessionLoginService.onSession(packet.sessionId, clientKey, packet.nonce, DateUtils.convertStrToTimestamp(packet.timestamp), packet.signature);
                methodInfo.user = session.get("username");
                this.sessionId = session.id;
                const ecKey = ec.genKeyPair();
                const der = Buffer.from(ecKey.derive(clientKey.getPublic()).toString("hex", 2), "hex");
                const z = Utils.fillTo32(der);
                const response: types.packet.SessionResponsePacket = {
                    type: "session",
                    key: ByteBuffer.wrap(Buffer.from(ecKey.getPublic(true, "binary"))),
                    agent: this.getServerAgent(),
                    config: this.getServerConfig(),
                };
                this.send(this.psonHelper.pson_encode(response), ContentType.HANDSHAKE);
                this.setPreMasterSecret(z);
                this.changeWriteCipherSpec();
                methodInfo.success = true;
                methodInfo.response = response;
            });
        }
        else if (raw.type == "ticket_request") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.TicketsRequestPacket>raw;
                this.validators.validate("handshake_ticket_request", packet);
                methodInfo.method = "ticket_request";
                methodInfo.sessionId = this.sessionId;
                methodInfo.params = packet;
                this.logger.debug("ticket_request");
                const tickets = await this.generateTickets(packet.count);
                const ticketResponse: types.packet.TicketsResponsePacket = {
                    type: "ticket_response",
                    tickets: tickets.ids.map(x => ByteBuffer.wrap(x)),
                    ttl: Math.floor(tickets.ttl / 1000)
                };
                methodInfo.success = true;
                methodInfo.response = ticketResponse;
                this.send(this.psonHelper.pson_encode(ticketResponse), ContentType.HANDSHAKE);
            });
        }
        else if (raw.type == "ticket") {
            const packet = <types.packet.TicketPacket>raw;
            this.validators.validate("handshake_ticket", packet);
            const ticketId = <TicketId>packet.ticket_id.toBuffer();
            const clientRandom = packet.client_random.toBuffer();
            this.logger.debug("ticket " + Hex.from(ticketId));
            const ticketData = await this.useTicket(ticketId);
            if (!ticketData) {
                throw new RpcError("Invalid ticket");
            }
            if (this.sessionValidator) {
                const validSession = await this.sessionValidator(ticketData.sessionId);
                if (validSession === false) {
                    throw new RpcError("INVALID_PROXY_SESSION");
                }
            }
            this.restore(ticketId, ticketData, clientRandom, !!packet.plain);
        }
        else if (raw.type == "srp_init") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.SrpInitRequestPacket>raw;
                this.validators.validate("handshake_srp_init", packet);
                methodInfo.method = "srp_init";
                methodInfo.user = packet.I;
                methodInfo.params = packet;
                // srp init client request
                if (this.srpLoginService === null) {
                    throw new RpcError("SRP handshake unavailable");
                }
                this.logger.debug("srp init request", {packet: packet});
                const properties = packet.properties != null ? packet.properties : {};
                if (packet.agent != null) {
                    this.clientAgent = packet.agent;
                }
                const response = await this.srpLoginService.init(packet.I, packet.host, properties);
                const srpResponse: types.packet.SrpInitResponsePacket = {
                    type: "srp_init",
                    agent: this.getServerAgent(),
                    config: this.getServerConfig(),
                    sessionId: response.sessionId,
                    N: response.N,
                    g: response.g,
                    k: response.k,
                    s: response.s,
                    B: response.B,
                    loginData: response.loginData
                };
                methodInfo.success = true;
                methodInfo.sessionId = response.sessionId;
                methodInfo.response = srpResponse;
                this.logger.debug("send srp init response", {response: srpResponse});
                this.send(
                    this.psonHelper.pson_encode(srpResponse),
                    ContentType.HANDSHAKE
                );
            });
        }
        else if (raw.type == "srp_exchange") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.SrpExchangeRequestPacket>raw;
                this.validators.validate("handshake_srp_exchange", packet);
                // srp exchange client request ( handshake finished - server side )
                const ssid = packet.sessionId;
                methodInfo.method = "srp_exchange";
                methodInfo.params = packet;
                methodInfo.sessionId = ssid;
                this.logger.debug("sessionId " + ssid, {packet: packet});
                const A = Hex.toBN(packet.A);
                const M1 = Hex.toBN(packet.M1);
                const response = await this.srpLoginService.exchange(methodInfo, ssid, A, M1, true, packet.sessionKey);
                const K = Utils.fillTo32(response.K);
                this.sessionId = ssid;
                this.setPreMasterSecret(K);
                this.logger.debug("generate tickets after srp " + packet.tickets);
                const tickets = await this.generateTickets(packet.tickets);
                const srpResponse: types.packet.SrpExchangeResponsePacket = {
                    type: "srp_exchange",
                    M2: response.M2,
                    additionalLoginStep: response.additionalLoginStep,
                    tickets: tickets.ids.map(x => ByteBuffer.wrap(x)),
                    ttl: Math.floor(tickets.ttl / 1000)
                };
                methodInfo.success = true;
                methodInfo.response = srpResponse;
                this.logger.debug("srp exchange done on server", {response: srpResponse});
                this.send(
                    this.psonHelper.pson_encode(srpResponse),
                    ContentType.HANDSHAKE
                );
                this.changeWriteCipherSpec();
            });
        }
        else if (raw.type == "ecdhef") {
            const packet = <types.packet.EcdhefRequestPacket>raw;
            this.logger.debug("ecdhef request", {packet: packet});
            this.validators.validate("handshake_ecdhef", packet);
            const serverKeystore = await this.serverKeystoreProvider();
            const key = serverKeystore !== null ? serverKeystore.getKeyById(packet.key_id.toBuffer()) : null;
            if (key === null) {
                throw new RpcError("Cannot find key with id " + packet.key_id);
            }
            const ec = elliptic.ec("secp256k1");
            const ecKey = ec.keyFromPublic(packet.key.toBuffer());
            this.logger.debug("derive");
            const der = Buffer.from((<pki.common.keystore.EccKeyPair>key.keyPair).keyPair.derive(ecKey.getPublic()).toString("hex", 2), "hex");
            const z = Utils.fillTo32(der);
            this.setPreMasterSecret(z);
            this.changeWriteCipherSpec();
        }
        else if (raw.type === "key_init") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.KeyInitRequestPacket>raw;
                this.validators.validate("handshake_key_init", packet);
                methodInfo.method = "key_init";
                methodInfo.params = packet;
                // key init client request
                if (this.keyLoginService === null) {
                    throw new RpcError("Key Login handshake unavailable");
                }
                this.logger.debug("key login init request", {packet: packet});
                if (packet.agent != null) {
                    this.clientAgent = packet.agent;
                }
                const response = await this.keyLoginService.init(methodInfo, packet.pub, packet.properties);
                const keyResponse: types.packet.KeyInitResponsePacket = {
                    type: "key_init",
                    sessionId: response.sessionId,
                    I: response.I,
                    pub: response.pub,
                    agent: this.getServerAgent(),
                    config: this.getServerConfig(),
                };
                this.logger.debug("send key init response", {response: keyResponse});
                methodInfo.success = true;
                methodInfo.sessionId = response.sessionId;
                methodInfo.response = keyResponse;
                this.send(
                    this.psonHelper.pson_encode(keyResponse),
                    ContentType.HANDSHAKE
                );
            });
        }
        else if (raw.type === "key_exchange") {
            await this.requestLogger.runWith(async methodInfo => {
                const packet = <types.packet.KeyExchangeRequestPacket>raw;
                this.validators.validate("handshake_key_exchange", packet);
                methodInfo.method = "key_exchange";
                methodInfo.params = packet;
                methodInfo.sessionId = packet.sessionId;
                // key exchange client request
                // let paramsRaw = {
                //     sessionId: packet.sessionId,
                //     nonce: packet.nonce,
                //     timestamp: packet.timestamp,
                //     signature: packet.signature,
                //     K: packet.K
                // };
                // let params = this.validators.validateModel("keyExchange", paramsRaw);
                const response = await this.keyLoginService.exchange(
                    methodInfo, packet.sessionId, packet.nonce, DateUtils.convertStrToTimestamp(packet.timestamp),
                    packet.signature, packet.K, true, packet.sessionKey
                );
                this.sessionId = packet.sessionId;
                const K = Utils.fillTo32(response.K);
                this.setPreMasterSecret(K);
                this.logger.debug("generate tickets after key login " + packet.tickets);
                const tickets = await this.generateTickets(packet.tickets);
                const keyResponse: types.packet.KeyExchangeResponsePacket = {
                    type: "key_exchange",
                    additionalLoginStep: response.additionalLoginStep,
                    tickets: tickets.ids.map(x => ByteBuffer.wrap(x)),
                    ttl: Math.floor(tickets.ttl / 1000)
                };
                this.logger.debug("send key exchange response", {response: keyResponse});
                methodInfo.success = true;
                methodInfo.response = keyResponse;
                this.send(
                    this.psonHelper.pson_encode(keyResponse),
                    ContentType.HANDSHAKE
                );
                this.changeWriteCipherSpec();
            });
        }
    }
    
    async processHelloPacket(helloPacket: string) {
        if (this.configService.values.application.allowUnauthorized) {
            return;
        }
        const fields = helloPacket.split(";");
        if (fields.length != 4) {
            throw new RpcError("Invalid hello packet");
        }
        const [appId, timestamp, nonce, signature] = fields;
        const app = this.configService.values.application.allowed.find(x => x.appId === appId);
        if (!app) {
            throw new RpcError("Unknown application in hello packet");
        }
        if (DateUtils.timeElapsed(DateUtils.convertStrToTimestamp(timestamp as types.core.TimestampStr), this.configService.values.application.maxTimeDiff)) {
            throw new RpcError("Invalid timestamp in hello packet");
        }
        const toSign = Buffer.from(appId + ";" + timestamp + ";" + nonce + ";" + app.appSeret, "utf8");
        const hash = Crypto.sha256(toSign).slice(0, 16).toString("hex");
        if (hash !== signature) {
            throw new RpcError("Invalid signature in hello packet");
        }
    }
    
    getServerAgent(): types.core.UserAgent {
        return this.serverAgent.getAgent();
    }
    
    getCurrentTicketData(): TicketData {
        return {
            sessionId: this.sessionId,
            agent: this.clientAgent,
            masterSecret: this.masterSecret
        };
    }
    
    generateTickets(count: number) {
        return this.ticketsDb.generateTickets(null, Math.min(count, 50), this.getCurrentTicketData());
    }
    
    useTicket(ticketId: TicketId) {
        return this.ticketsDb.useTicket(null, ticketId);
    }
    
    restore(ticketId: TicketId, ticketData: TicketData, clientRandom: Buffer, plain: boolean) {
        const data = ticketData;
        this.sessionId = data.sessionId;
        this.clientAgent = data.agent;
        this.restoreState(ticketId, data.masterSecret, clientRandom, plain);
    }
    
    getFreshRWStatesFromParams(client: RWState, server: RWState) {
        return {
            readState: client,
            writeState: server
        };
    }
    
    getSessionId(): types.core.SessionId {
        return this.sessionId;
    }
}
