/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { Logger } from "../../service/log/LoggerFactory";
import { BinaryRepository2 } from "../BinaryRepository";
import { Binary } from "mongodb";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";

export class MongoBinaryDb<K extends string> implements BinaryRepository2<K> {
    
    constructor(
        private collection: mongodb.Collection<{_id: string, data: Binary}>,
        private session: mongodb.ClientSession|undefined,
        private logger: Logger,
    ) {
    }
    
    getOptions<T extends {session?: mongodb.ClientSession}>(opt?: T): T {
        opt = opt || <T>{};
        if (this.session) {
            opt.session = this.session;
        }
        return opt;
    }
    
    async insert(key: K, value: Buffer): Promise<void> {
        const startTime = MicroTimeUtils.now();
        try {
            await this.collection.replaceOne({_id: key}, {data: new Binary(value)}, this.getOptions<mongodb.ReplaceOptions>({upsert: true}));
            return;
        }
        finally {
            this.logger.time(startTime, "Mongo insert", this.collection.collectionName, key);
        }
    }
    
    async get(key: K): Promise<Buffer|null> {
        const startTime = MicroTimeUtils.now();
        try {
            const x = await this.collection.findOne({_id: key}, this.getOptions());
            return x ? Buffer.from(x.data.buffer) : null;
        }
        finally {
            this.logger.time(startTime, "Mongo get", this.collection.collectionName, key);
        }
    }
    
    async getOrDefault(key: K, def: Buffer): Promise<Buffer> {
        const startTime = MicroTimeUtils.now();
        try {
            const x = await this.collection.findOne({_id: key}, this.getOptions());
            return x ? Buffer.from(x.data.buffer) : def;
        }
        finally {
            this.logger.time(startTime, "Mongo get", this.collection.collectionName, key);
        }
    }
    
    async getEntries(keys: K[]): Promise<{key: K; value: Buffer;}[]> {
        const startTime = MicroTimeUtils.now();
        try {
            const list = await this.collection.find({_id: {$in: keys}}, this.getOptions()).toArray();
            return list.map(x => ({key: x._id as K, value: Buffer.from(x.data.buffer)}));
        }
        finally {
            this.logger.time(startTime, "Mongo getEntries", this.collection.collectionName, keys);
        }
    }
    
    async getKeys(keys: K[]): Promise<K[]> {
        const startTime = MicroTimeUtils.now();
        try {
            const list = await this.collection.find({_id: {$in: keys}}, this.getOptions()).project({_id: 1}).toArray();
            return list.map(x => x._id);
        }
        finally {
            this.logger.time(startTime, "Mongo getKeys", this.collection.collectionName, keys);
        }
    }
    
    async getAllKeys(): Promise<K[]> {
        const startTime = MicroTimeUtils.now();
        try {
            const list = await this.collection.find({}, this.getOptions()).project({_id: 1}).toArray();
            return list.map(x => x._id);
        }
        finally {
            this.logger.time(startTime, "Mongo getAllKeys", this.collection.collectionName);
        }
    }
    
    async count(): Promise<number> {
        const startTime = MicroTimeUtils.now();
        try {
            return await this.collection.countDocuments({}, this.getOptions());
        }
        finally {
            this.logger.time(startTime, "Mongo count", this.collection.collectionName);
        }
    }
    
    async exists(key: K): Promise<boolean> {
        const startTime = MicroTimeUtils.now();
        try {
            const list = await this.collection.find({_id: key}, this.getOptions()).project({_id: 1}).toArray();
            return list.length > 0;
        }
        finally {
            this.logger.time(startTime, "Mongo exists", this.collection.collectionName, key);
        }
    }
    
    async clear(): Promise<void> {
        await this.collection.deleteMany({});
    }
}
