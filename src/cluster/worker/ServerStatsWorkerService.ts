/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as db from "../../db/Model";
import * as types from "../../types";
import { ServerStatsRepository } from "../../service/misc/ServerStatsRepository";
import { JobService } from "../../service/job/JobService";
import * as mongodb from "mongodb";
import { Config } from "../common/ConfigUtils";

export type InstanceEntry = {host: types.core.Host, dbName: string, map: Map<db.system.ServerStatsId, StatsEntry>};
export type StatsEntry = {id: db.system.ServerStatsId, executionTime: number, requests: number, errors: number, tid: NodeJS.Timeout|null};

export class ServerStatsWorkerService {
    
    private map: Map<string, InstanceEntry> = new Map();
    
    constructor(
        private config: Config,
        private jobService: JobService,
        private mongoClient: mongodb.MongoClient,
    ) {
    }
    
    addRequestInfo(host: types.core.Host, dbName: string, executionTime: number, requests: number, errors: number) {
        if (!this.config.server.logStats) {
            return;
        }
        const instanceEntry = this.getOrCreateInstance(host, dbName);
        const statsEntry = this.getOrCreateStats(instanceEntry);
        this.increaseStats(statsEntry, executionTime, requests, errors);
        this.resheduleStatsFlush(instanceEntry, statsEntry);
    }
    
    async flush() {
        const promises: Promise<void>[] = [];
        for (const instanceEntry of this.map.values()) {
            for (const statsEntry of instanceEntry.map.values()) {
                if (statsEntry.tid) {
                    clearTimeout(statsEntry.tid);
                }
                promises.push(this.flushEntry(instanceEntry, statsEntry));
            }
        }
        this.map.clear();
        await Promise.all(promises);
    }
    
    private getOrCreateInstance(host: types.core.Host, dbName: string) {
        const entry = this.map.get(host);
        if (entry) {
            return entry;
        }
        const newEntry: InstanceEntry = {host: host, dbName: dbName, map: new Map()};
        this.map.set(host, newEntry);
        return newEntry;
    }
    
    private getOrCreateStats(instanceEntry: InstanceEntry) {
        const statsId = ServerStatsRepository.getCurrentId();
        const entry = instanceEntry.map.get(statsId);
        if (entry) {
            return entry;
        }
        const newEntry: StatsEntry = {id: statsId, executionTime: 0, requests: 0, errors: 0, tid: null};
        instanceEntry.map.set(statsId, newEntry);
        return newEntry;
    }
    
    private increaseStats(statsEntry: StatsEntry, executionTime: number, requests: number, errors: number) {
        statsEntry.executionTime += executionTime;
        statsEntry.requests += requests;
        statsEntry.errors += errors;
    }
    
    private resheduleStatsFlush(instanceEntry: InstanceEntry, statsEntry: StatsEntry) {
        if (statsEntry.tid) {
            clearTimeout(statsEntry.tid);
        }
        statsEntry.tid = setTimeout(() => {
            instanceEntry.map.delete(statsEntry.id);
            this.jobService.addJob(async () => {
                await this.flushEntry(instanceEntry, statsEntry);
            }, "Flush server stats");
        }, 3000);
    }
    
    private async flushEntry(instanceEntry: InstanceEntry, statsEntry: StatsEntry) {
        const hostDb = this.mongoClient.db(instanceEntry.dbName);
        const collection = hostDb.collection(ServerStatsRepository.COLLECTION_NAME);
        await collection.updateOne(
            {
                _id: statsEntry.id,
            },
            {
                $inc: {requests: statsEntry.requests, errors: statsEntry.errors, executionTime: statsEntry.executionTime},
                $max: {maxTime: statsEntry.executionTime}, $min: {minTime: statsEntry.executionTime},
            },
            {
                upsert: true,
            },
        );
    }
}
