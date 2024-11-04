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
import * as pki from "privmx-pki2";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";

export interface KVEntry {
    _id: string;
    data: string;
}

export class MongoKVRepository implements pki.db.KVRepository {
    
    constructor(
        private collection: mongodb.Collection<any>,
        private session: mongodb.ClientSession,
        private logger: Logger
    ) {
    }
    
    getOptions<T extends {session?: mongodb.ClientSession} = any>(opt?: T): T {
        opt = opt || <T>{};
        if (this.session) {
            opt.session = this.session;
        }
        return opt;
    }
    
    async get(key: string): Promise<Buffer> {
        const startTime = MicroTimeUtils.now();
        try {
            const result = await this.collection.findOne<KVEntry>({_id: key}, this.getOptions());
            return result ? Buffer.from(result.data, "hex") : null;
        }
        finally {
            this.logger.time(startTime, "Mongo get", this.collection.collectionName, key);
        }
    }
    
    async getAll(): Promise<Buffer[]> {
        const startTime = MicroTimeUtils.now();
        try {
            const results = await this.collection.find<KVEntry>({}, this.getOptions()).toArray();
            return results.map(x => Buffer.from(x.data, "hex"));
        }
        finally {
            this.logger.time(startTime, "Mongo getAll", this.collection.collectionName);
        }
    }
    
    async set(key: string, value: Buffer): Promise<void> {
        const startTime = MicroTimeUtils.now();
        try {
            await this.collection.updateOne({_id: key}, {$set: {data: value.toString("hex")}}, this.getOptions<mongodb.ReplaceOptions>({upsert: true}));
        }
        finally {
            this.logger.time(startTime, "Mongo update", this.collection.collectionName, key);
        }
    }
    
    async delete(key: string): Promise<void> {
        const startTime = MicroTimeUtils.now();
        try {
            await this.collection.deleteOne({_id: key}, this.getOptions());
        }
        finally {
            this.logger.time(startTime, "Mongo delete", this.collection.collectionName, key);
        }
    }
    
    async deleteAllContains(key: string): Promise<boolean> {
        const startTime = MicroTimeUtils.now();
        try {
            const obj = await this.collection.deleteMany({_id: new RegExp(key)}, this.getOptions());
            return obj.deletedCount > 0;
        }
        finally {
            this.logger.time(startTime, "Mongo delete all contains", this.collection.collectionName, key);
        }
    }
}
