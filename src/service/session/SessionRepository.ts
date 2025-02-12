/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { EcdheDataInSession } from "../../api/session/Session";
import { ConfigService } from "../config/ConfigService";
import { TicketDataRepository } from "./TicketDataRepository";
import * as mongodb from "mongodb";
export class SessionRepository {
    
    static readonly COLLECTION_NAME = "session";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.core.SessionId, db.session.Session>,
        private configService: ConfigService,
    ) {
    }
    
    async get(id: types.core.SessionId) {
        return this.repository.get(id);
    }
    
    async insert(id: types.core.SessionId, data: db.session.SessionData) {
        await this.repository.insert({id, data});
    }
    
    async updateData(id: types.core.SessionId, data: Partial<db.session.SessionData>) {
        const changes: Record<string, unknown> = {};
        for (const key in data) {
            changes["data." + key] = (data as any)[key];
        }
        await this.repository.collection.updateOne({_id: id}, {$set: changes}, {session: this.repository.getSession()});
    }
    
    async delete(id: types.core.SessionId) {
        await this.repository.delete(id);
    }
    
    async cleanOldSessions() {
        const list = <{_id: types.core.SessionId}[]> await this.repository.collection.aggregate([
            {
                $match: {
                    $and: [
                        {"data.createdDate": {$lt: Date.now() - 5000}}, // session exists at least 5 seconds
                        // session is not is init state but if it is it has no time left
                        {
                            $or: [
                                {
                                    $and: [
                                        {"data.state": {$ne: "init"}},
                                        {"data.state": {$ne: "keyInit"}},
                                    ],
                                },
                                {"data.createdDate": {$lt: Date.now() - this.configService.values.user.session.exchangeTimeout}},
                            ],
                        },
                        // session is not long-living but if it is it has not time left
                        {
                            $or: [
                                {"data.restoreKey": {$exists: false}},
                                {"data.lastUsage": {$lt: Date.now() - this.configService.values.user.session.restorableSessionTTL}},
                            ],
                        },
                    ],
                },
            },
            {
                $lookup: {
                    from: TicketDataRepository.COLLECTION_NAME,
                    localField: "_id",
                    foreignField: "sessionId",
                    as: "tickets",
                },
            },
            {
                $match: {
                    tickets: {$size: 0},
                },
            },
            {
                $project: {
                    _id: 1,
                },
            },
        ], {session: this.repository.getSession()}).toArray();
        const ids = list.map(x => x._id);
        if (ids.length > 0) {
            await this.repository.deleteMany(q => q.in("id", ids));
        }
        return ids;
    }
    
    async removeSessions(query: mongodb.Filter<any>) {
        const sessionCollection = this.repository.collection;
        const list = <{_id: types.core.SessionId}[]> await sessionCollection.find(query, {session: this.repository.getSession()}).project({_id: 1}).toArray();
        const ids = list.map(x => x._id);
        await sessionCollection.deleteMany({_id: {$in: ids}});
        return ids;
    }
    
    async switchUserRights(username: types.core.Username, type: types.user.UserType, rights: types.user.UserRightsMap) {
        const sessionCollection = this.repository.collection;
        await sessionCollection.updateMany({"data.username": username}, {$set: {"data.type": type, "data.rights": rights}}, {session: this.repository.getSession()});
    }
    
    async upgradeAllEcdheSessions(key: types.core.EccPubKey, data?: EcdheDataInSession) {
        const sessionCollection = this.repository.collection;
        if (data) {
            await sessionCollection.updateMany({"data.ecdhe.pub": key}, {$set: {"data.state": "exchange"}}, {session: this.repository.getSession()});
        }
        else {
            await sessionCollection.updateMany({"data.ecdhe.pub": key}, {$set: {"data.state": "exchange", "data.ecdhe": data}}, {session: this.repository.getSession()});
        }
    }
    
    async downgradeAllEcdheSessions(key: types.core.EccPubKey) {
        const sessionCollection = this.repository.collection;
        await sessionCollection.updateMany({"data.ecdhe.pub": key}, {$set: {"data.state": "ecdhePre", "data.ecdhe": {pub: key}}}, {session: this.repository.getSession()});
    }
}
