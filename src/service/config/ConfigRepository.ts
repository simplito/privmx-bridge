/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { InitConfigValues } from "./ConfigLoader";
import * as types from "../../types";
import { Hex } from "../../utils/Hex";
import { DateUtils } from "../../utils/DateUtils";

export type InitValue = ConfigInitValue|StateInitValue|LastJobRunValue;
export interface ConfigInitValue {
    _id: "config";
    value: InitConfigValues;
}
export interface StateInitValue {
    _id: "state";
    value: StateValue;
}
export interface LastJobRunValue {
    _id: "lastJobRun";
    value: types.core.Timestamp;
}
export interface StateValue {
    dbVersion: string;
    keystoreGenerated: boolean;
    adminGenerated: boolean;
    dataIdGenerated: boolean;
    cachedPkiAssigned: boolean;
    ticketKey: types.core.Hex;
}
export interface InitInfo {
    dbName: string;
    state: StateValue;
    lastJobRun: types.core.Timestamp;
}
export interface InitInfoWithConfig extends InitInfo {
    config: InitConfigValues;
}

export class ConfigRepository {
    
    constructor(
        private mongoClient: mongodb.MongoClient,
    ) {
    }
    
    async getInfo(dbName: string): Promise<InitInfoWithConfig> {
        const entries = (await this.getCollection(dbName).find({}).toArray()) as InitValue[];
        const config = entries.find(x => x._id === "config");
        const state = entries.find(x => x._id === "state");
        const lastJobRun = entries.find(x => x._id === "lastJobRun");
        return {
            dbName: dbName,
            config: config && config._id === "config" ? config.value : {},
            state: state && state._id === "state" ? state.value : {
                dbVersion: "",
                keystoreGenerated: false,
                adminGenerated: false,
                dataIdGenerated: false,
                cachedPkiAssigned: false,
                ticketKey: Hex.EMPTY,
            },
            lastJobRun: lastJobRun && lastJobRun._id === "lastJobRun" ? lastJobRun.value : DateUtils.EPOCH_N,
        };
    }
    
    async setState(dbName: string, state: StateValue) {
        await this.getCollection(dbName).updateOne({_id: "state"}, {$set: {value: state}}, {upsert: true});
    }
    
    async setConfig(dbName: string, config: InitConfigValues) {
        await this.getCollection(dbName).updateOne({_id: "config"}, {$set: {value: config}}, {upsert: true});
    }
    
    async updateLastJobRun(dbName: string, lastJobRun: types.core.Timestamp) {
        const now = DateUtils.now();
        if (lastJobRun === DateUtils.EPOCH_N) {
            await this.getCollection(dbName).insertOne({_id: "lastJobRun", value: now});
            return {updated: true, date: now};
        }
        const res = await this.getCollection(dbName).updateOne({_id: "lastJobRun", value: lastJobRun}, {$set: {value: now}});
        return {updated: res.modifiedCount > 0, date: now};
    }
    
    private getCollection(dbName: string) {
        return this.mongoClient.db(dbName).collection<InitValue>("init");
    }
}
