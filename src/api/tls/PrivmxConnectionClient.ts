/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ConnectionType } from "./ConnectionType";
import { RWState } from "./RWState";
import { Session } from "./Session";
import { Options, PasswordMixer } from "../../utils/crypto/PasswordMixer";
import { ContentType } from "./ContentType";
import { Crypto } from "../../utils/crypto/Crypto";
import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import { Base64 } from "../../utils/Base64";
import * as elliptic from "elliptic";
import { SrpLogic } from "../../utils/crypto/SrpLogic";
import * as pki from "privmx-pki2";
import * as types from "../../types";
import { PrivmxConnectionBase } from "./PrivmxConnectionBase";
import { Logger } from "../../service/log/Logger";
import * as BN from "bn.js";

export interface Ticket {
    id: Buffer;
    master_secret: Buffer;
}

export class PrivmxConnectionClient extends PrivmxConnectionBase {
    
    session: Session;
    tickets: {[ticketId: string]: Ticket};
    passwordMixer: PasswordMixer;
    ecKey: elliptic.ec.KeyPair|null;
    
    constructor(
        logger: Logger,
        private connectionType: number = ConnectionType.ONE_SHOT,
    ) {
        super(false, logger);
        this.session = new Session();
        this.tickets = {};
        this.passwordMixer = new PasswordMixer();
        this.ecKey = null;
    }
    
    async processHandshakePacket(raw: {type: string}): Promise<void> {
        const responseProcessing = this.connectionType == ConnectionType.ONE_SHOT;
        if (raw.type == "ecdhe") {
            const packet = <types.packet.EcdheResponsePacket>raw;
            const ec = elliptic.ec("secp256k1");
            
            let ecKey: elliptic.ec.KeyPair;
            if (this.session.contains("ecdhe_key")) {
                // Jeżeli mamy klucz w sesji to znaczy, że to odpowiedź na zainicjowany przez nas handshake
                // pobieramy i usuwamy klucz z sesji bo handshake właśnie się kończy
                ecKey = ec.keyPair(this.session.get("ecdhe_key"));
                this.session.delete("ecdhe_key");
                this.session.save("server_agent", packet.agent != null ? packet.agent : null);
            }
            else {
                throw new Error("Unexpected ecdhe packet from server");
            }
            
            const pubKey = ec.keyFromPublic(packet.key);
            const der = Buffer.from(ecKey.derive(pubKey.getPublic()).toString("hex", 2), "hex");
            const z = Utils.fillTo32(der);
            this.setPreMasterSecret(z);
            if (!responseProcessing) {
                this.changeWriteCipherSpec();
            }
        }
        else if (raw.type == "ticket_response") {
            const packet = <types.packet.TicketsResponsePacket>raw;
            this.logger.debug("ticket_response");
            this.saveTickets(packet.tickets);
        }
        else if (raw.type == "srp_init") {
            // srp init response from server
            const packet = <types.packet.SrpInitResponsePacket>raw;
            this.logger.debug({packet: packet}, "srp init response");
            this.session.save("server_agent", packet.agent != null ? packet.agent : null);
            const exchange = this.validateSrpInit(packet);
            this.reset(true);
            this.ticketHandshake();
            this.logger.debug({request: exchange}, "srp exchange request");
            this.send(
                this.getEncoder().encode(exchange),
                ContentType.HANDSHAKE,
            );
        }
        else if (raw.type == "srp_exchange") {
            // srp exchange response from server ( handshake finished )
            const packet = <types.packet.SrpExchangeResponsePacket>raw;
            this.validateSrpExchange(packet);
            this.logger.debug("srp handshake successful");
        }
    }
    
    async processHelloPacket(_helloPacket: string) {
        // Do nothing
    }
    
    getClientAgent(): types.core.UserAgent {
        return <types.core.UserAgent>"webmail-server-php;1.0.0";
    }
    
    ecdheHandshake(): void {
        if (this.session.contains("ecdhe_key")) {
            throw new Error("Invalid handshake state");
        }
        const ec = elliptic.ec("secp256k1");
        const ecKey = ec.genKeyPair();
        this.ecKey = ecKey;
        
        const packet: types.packet.EcdheRequestPacket = {
            type: "ecdhe",
            key: Buffer.from(ecKey.getPublic(true, "binary")),
            agent: this.getClientAgent(),
        };
        const serializedPayload = this.getEncoder().encode(packet);
        this.send(serializedPayload, ContentType.HANDSHAKE);
        
        this.session.save("ecdhe_key", {
            pub: ecKey.getPublic("hex"),
            pubEnc: "hex",
            priv: ecKey.getPrivate("hex"),
            privEnc: "hex",
        });
    }
    
    ecdhefHandshake(key: pki.common.Types.keystore.IKeyPair2) {
        const ec = elliptic.ec("secp256k1");
        const ecKey = ec.genKeyPair();
        this.ecKey = ecKey;
        
        const packet: types.packet.EcdhefRequestPacket = {
            type: "ecdhef",
            key_id: key.getKeyId(),
            key: Buffer.from(ecKey.getPublic(true, "binary")),
            agent: this.getClientAgent(),
        };
        const serializedPayload = this.getEncoder().encode(packet);
        
        this.send(serializedPayload, ContentType.HANDSHAKE);
        const der = Buffer.from(ecKey.derive((<pki.common.keystore.EccKeyPair>key).keyPair.getPublic()).toString("hex", 2), "hex");
        const z = Utils.fillTo32(der);
        this.setPreMasterSecret(z);
        this.changeWriteCipherSpec();
    }
    
    srpHandshake(hashmail: types.core.Hashmail, password: string, tickets: number = 1): void {
        const split = Utils.splitHashmail(hashmail);
        if (split.length !== 2) {
            throw new Error("Incorrect hashmail {hashmail}");
        }
        const username = split[0];
        const host = split[1];
        if (this.session.contains("srp_data")) {
            throw new Error("Invalid handshake state");
        }
        const packet: types.packet.SrpInitRequestPacket = {
            type: "srp_init",
            I: username,
            host: host,
            agent: this.getClientAgent(),
        };
        const serializedPayload = this.getEncoder().encode(packet);
        this.send(serializedPayload, ContentType.HANDSHAKE);
        this.session.save("srp_data", {I: username, password: password, tickets: tickets});
    }
    
    reset(keepSession: boolean = false): void {
        this.logger.debug("reset");
        this.writeState = new RWState();
        this.readState = new RWState();
        this.nextReadState = new RWState();
        this.nextWriteState = new RWState();
        this.clientRandom = Buffer.alloc(0);
        this.serverRandom = Buffer.alloc(0);
        this.masterSecret = Buffer.alloc(0);
        if (keepSession === true) {
            return;
        }
        this.session = new Session();
    }
    
    ticketHandshake(): void {
        const ticketIds = Object.keys(this.tickets);
        if (ticketIds.length == 0) {
            throw new Error("No tickets");
        }
        const ticket = this.tickets[ticketIds[0]];
        delete this.tickets[ticketIds[0]];
        const clientRandom = Crypto.randomBytes(12);
        
        const packet: types.packet.TicketPacket = {
            type: "ticket",
            ticket_id: ticket.id,
            client_random: clientRandom,
        };
        const serializedPayload = this.getEncoder().encode(packet);
        this.logger.debug("send ticket handshake");
        
        this.send(serializedPayload, ContentType.HANDSHAKE);
        this.restore(ticket, clientRandom);
    }
    
    ticketRequest(n: number = 1): void {
        const packet: types.packet.TicketsRequestPacket = {
            type: "ticket_request",
            count: n,
        };
        this.send(this.getEncoder().encode(packet), ContentType.HANDSHAKE);
    }
    
    saveTickets(tickets: Buffer[]) {
        for (const ticketId of tickets) {
            this.tickets[Hex.from(ticketId)] = {
                id: ticketId,
                master_secret: this.masterSecret,
            };
        }
    }
    
    useTicket(ticketId: Buffer) {
        const ticketIdHex = Hex.from(ticketId);
        this.logger.debug({ticketId: ticketIdHex}, "using ticket");
        if (this.tickets[ticketIdHex] != null) {
            const ticket = this.tickets[ticketIdHex];
            delete this.tickets[ticketIdHex];
            return ticket;
        }
        return false;
    }
    
    restore(ticket: Ticket, clientRandom: Buffer) {
        this.restoreState(ticket.id, ticket.master_secret, clientRandom, false);
    }
    
    getFreshRWStatesFromParams(client: RWState, server: RWState) {
        return {
            readState: server,
            writeState: client,
        };
    }
    
    validateSrpInit(frame: types.packet.SrpInitResponsePacket): types.packet.SrpExchangeRequestPacket {
        const data = this.session.get<{I: string, password: string, tickets: number}>("srp_data");
        
        // srp init - server response
        if (!data || data.I == null || !data.password == null) {
            throw new Error("Invalid handshake state");
        }
        
        const tickets = data.tickets != null ? data.tickets : 1;
        const s = Hex.toBuf(frame.s);
        const B = Hex.toBN(frame.B);
        const N = Hex.toBN(frame.N);
        const g = Hex.toBN(frame.g);
        const k = Hex.toBN(frame.k);
        const loginData = JSON.parse(frame.loginData) as Options;
        
        if (!SrpLogic.valid_B(B, N)) {
            throw new Error("Invalid B - " + frame.B + ", N: " + frame.N);
        }
        
        const a = SrpLogic.get_small_a();
        const A = SrpLogic.get_A(g, N, a);
        const P = this.passwordMixer.mix(data.password, loginData);
        const x = SrpLogic.get_x(s, data.I, Base64.from(P));
        const v = SrpLogic.get_v(g, N, x);
        const u = SrpLogic.get_u(A, B, N);
        const S = SrpLogic.getClient_S(B, k, v, a, u, x, N);
        const M1 = SrpLogic.get_M1(A, B, S, N);
        this.logger.debug({
            A: Hex.fromBN(A),
            B: Hex.fromBN(B),
            S: Hex.fromBN(S),
            N: Hex.fromBN(N),
        }, "Client M1");
        
        const M2 = SrpLogic.get_M2(A, M1, S, N);
        const K = SrpLogic.get_big_K(S, N);
        this.session.save("srp_data", {M2: M2, K: K});
        
        return {
            type: "srp_exchange",
            A: Hex.fromBN(A),
            M1: Hex.fromBN(M1),
            sessionId: frame.sessionId,
            tickets: tickets,
        };
    }
    
    validateSrpExchange(frame: types.packet.SrpExchangeResponsePacket) {
        const data = this.session.get<{M2: BN, K: Buffer}>("srp_data");
        if (!data || data.M2 == null || data.K == null) {
            throw new Error("Invalid handshake state");
        }
        if (data.M2.cmp(Hex.toBN(frame.M2)) != 0) {
            throw new Error("Invalid M2 - " + frame.M2 + ", expected " + data.M2.toString("hex"));
        }
        
        const K = Utils.fillTo32(data.K);
        this.setPreMasterSecret(K);
        
        // flush old tickets
        this.tickets = {};
        this.saveTickets(frame.tickets);
    }
}
