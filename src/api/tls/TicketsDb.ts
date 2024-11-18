/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Hex } from "../../utils/Hex";
import * as types from "../../types";
import { Crypto } from "../../utils/crypto/Crypto";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import { Base64 } from "../../utils/Base64";
import { ConfigService } from "../../service/config/ConfigService";
import { TicketKeyHolder } from "./TicketKeyHolder";
import { Utils } from "../../utils/Utils";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as mongodb from "mongodb";
import { SessionStorage } from "../session/SessionStorage";

export type TicketId = Buffer&{__ticketId: never};
export type TicketIdHex = types.core.Hex&{__ticketIdHex: never};

export interface TicketData {
    sessionId: types.core.SessionId|undefined;
    agent: types.core.UserAgent|undefined;
    masterSecret: Buffer;
}

export interface TicketDbEntry {
    data: TicketData;
    tickets: TicketIdHex[];
    createDate: types.core.Timestamp;
}

export class TicketsDb {
    
    constructor(
        private configService: ConfigService,
        private ticketKeyHolder: TicketKeyHolder,
        private repositoryFactory: RepositoryFactory,
        private sessionStorage: SessionStorage,
    ) {
    }
    
    async generateTickets(session: mongodb.ClientSession|undefined, count: number, ticketData: TicketData): Promise<{ids: TicketId[], ttl: types.core.Timespan}> {
        if (count === 0) {
            return {
                ids: [],
                ttl: this.getTicketsTTL()
            };
        }
        const ticketDataId = Crypto.randomBytes(16);
        const ticketsIds: TicketId[] = [];
        const ticketKey = this.ticketKeyHolder.getKey();
        for (let i = 0; i < count; ++i) {
            const iv = Crypto.randomBytes(16);
            const encryptedTicketDataId = Crypto.aes256CbcEncrypt(ticketDataId, ticketKey, iv);
            ticketsIds.push(<TicketId>Buffer.concat([iv, encryptedTicketDataId]));
        }
        const dbTicketData: db.session.TicketData = {
            id: Hex.from(ticketDataId) as db.session.TicketDataId,
            createDate: DateUtils.now(),
            sessionId: ticketData.sessionId,
            agent: ticketData.agent,
            masterSecret: Base64.from(ticketData.masterSecret),
        };
        await this.repositoryFactory.createTicketDataRepository(session).insert(dbTicketData);
        return {
            ids: ticketsIds,
            ttl: this.getTicketsTTL()
        };
    }
    
    async useTicket(session: mongodb.ClientSession|undefined, ticketId: TicketId): Promise<TicketData|null> {
        if (ticketId.length != 32) {
            return null;
        }
        const ticketDataIdRes = Utils.try(() => Crypto.aes256CbcDecrypt(ticketId.slice(16), this.ticketKeyHolder.getKey(), ticketId.slice(0, 16)));
        if (ticketDataIdRes.success === false) {
            return null;
        }
        const ticketDataId = Hex.from(ticketDataIdRes.result) as db.session.TicketDataId;
        const data = await this.repositoryFactory.createTicketDataRepository(session).getWithSessionAndCleanIfExpired(ticketDataId, this.getTicketsTTL());
        if (!data) {
            return null;
        }
        if (data.session) {
            this.sessionStorage.setPrefetched(data.session);
        }
        const res: TicketData = {
            sessionId: data.ticketData.sessionId,
            agent: data.ticketData.agent,
            masterSecret: Base64.toBuf(data.ticketData.masterSecret),
        };
        return res;
    }
    
    getTicketsTTL() {
        return this.configService.values.user.session.ticketsTTL;
    }
    
    async cleanTicketsDb(session: mongodb.ClientSession|undefined) {
        await this.repositoryFactory.createTicketDataRepository(session).deleteExpired(this.getTicketsTTL());
    }
    
    async removeTickestBySessions(session: mongodb.ClientSession|undefined, sessionIds: types.core.SessionId[]) {
        await this.repositoryFactory.createTicketDataRepository(session).removeBySessions(sessionIds);
    }
}
