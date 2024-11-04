/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ServerStatsWorkerService } from "../../cluster/worker/ServerStatsWorkerService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { DateUtils } from "../../utils/DateUtils";
import * as types from "../../types";
import { MongoDbManager } from "../../db/mongo/MongoDbManager";

export class ServerStatsService {
    
    constructor(
        private instanceHost: types.core.Host,
        private mongoDbManager: MongoDbManager,
        private serverStatsWorkerService: ServerStatsWorkerService,
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    addRequestInfo(time: number, requests: number, errors: number): void {
        this.serverStatsWorkerService.addRequestInfo(this.instanceHost, this.mongoDbManager.getDbName(), time, requests, errors);
    }
    
    getStats() {
        return this.repositoryFactory.createServerStatsRepository().getLastStats(60);
    }
    
    clearOld() {
        return this.repositoryFactory.createServerStatsRepository().removeOlderThan(DateUtils.minutes(60));
    }
}
