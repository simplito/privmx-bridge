/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as db from "../../db/Model";
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { RawMongo } from "../../CommonTypes";

export class TicketDataRepository {
    
    static readonly COLLECTION_NAME = "ticketData";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.session.TicketDataId, db.session.TicketData>,
    ) {
    }
    
    async getAndCleanIfExpired(id: db.session.TicketDataId, ttl: types.core.Timespan) {
        const data = await this.repository.get(id);
        if (!data) {
            return null;
        }
        if (DateUtils.timeElapsed(data.createDate, ttl)) {
            await this.repository.delete(id);
            return null;
        }
        return data;
    }
    
    async getWithSessionAndCleanIfExpired(id: db.session.TicketDataId, ttl: types.core.Timespan) {
        const array: (RawMongo<db.session.TicketData&{sessions: RawMongo<db.session.Session>[]}>)[] = (await this.repository.collection.aggregate([
            {
                $match: {
                    _id: id,
                }
            },
            {
                $lookup: {
                    from: SessionRepository.COLLECTION_NAME,
                    localField: "sessionId",
                    foreignField: "_id",
                    as: "sessions"
                }
            }
        ]).toArray()) as any[];
        const rawTicketData = array[0];
        if (!rawTicketData) {
            return null;
        }
        const rawSession = rawTicketData.sessions[0];
        if (DateUtils.timeElapsed(rawTicketData.createDate, ttl)) {
            await this.repository.delete(id);
            return null;
        }
        const ticketData: db.session.TicketData = {id: rawTicketData._id, agent: rawTicketData.agent, createDate: rawTicketData.createDate, masterSecret: rawTicketData.masterSecret, sessionId: rawTicketData.sessionId};
        const session: db.session.Session|null = rawSession ? {id: rawSession._id, data: rawSession.data} : null;
        return {ticketData, session};
    }
    
    async insert(value: db.session.TicketData) {
        await this.repository.insert(value);
    }
    
    async deleteExpired(ttl: types.core.Timespan) {
        await this.repository.deleteMany(q => q.lt("createDate", DateUtils.nowSub(ttl)));
    }
    
    async removeBySessions(sessionIds: types.core.SessionId[]) {
        await this.repository.deleteMany(q => q.in("sessionId", sessionIds));
    }
}

import { SessionRepository } from "./SessionRepository";

