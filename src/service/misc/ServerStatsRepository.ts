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

export interface StatsInfo {
    date: number;
    requests: number;
    errors: number;
    executionTime: number;
    avgTime: number;
    maxTime: number;
    minTime: number;
}

export class ServerStatsRepository {
    
    static readonly COLLECTION_NAME = "server_stats";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.system.ServerStatsId, db.system.ServerStats>,
    ) {
    }
    
    async getLast(count: number) {
        return this.repository.query(q => q.empty()).sort("id", false).limit(count).array();
    }
    
    async getLastStats(count: number) {
        const list = await this.getLast(count);
        return list.map(x => {
            const res: StatsInfo = {
                date: x.id,
                requests: x.requests,
                errors: x.errors,
                executionTime: x.executionTime,
                avgTime: x.executionTime / x.requests,
                maxTime: x.maxTime,
                minTime: x.minTime,
            };
            return res;
        });
    }
    
    async removeOlderThan(time: types.core.Timespan) {
        const lastTimestamp = DateUtils.nowSub(time);
        const lastId = ServerStatsRepository.getId(lastTimestamp);
        await this.repository.deleteMany(q => q.lt("id", lastId));
    }
    
    static getId(timestamp: types.core.Timestamp) {
        const date = Math.floor(timestamp / 10000) * 10000;
        return date as db.system.ServerStatsId;
    }
    
    static getCurrentId() {
        return ServerStatsRepository.getId(DateUtils.now());
    }
}
