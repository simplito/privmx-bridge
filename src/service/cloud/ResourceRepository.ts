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

export class ResourceRepository {
    
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.resource.ResourceId, db.resource.Resource>,
    ) {
    }
    
    async get(id: types.resource.ResourceId) {
        return this.repository.get(id);
    }
    
    async getAll() {
        return this.repository.getAll();
    }
    
    async getAllForUser(userId: types.cloud.UserId) {
        return this.repository.collection.find({"acl.users": userId}, {session: this.repository.getSession()}).toArray();
    }
    
    async getAllByParent(parentId: types.resource.ResourceId): Promise<db.resource.Resource[]> {
        return this.repository.collection.find({"acl.ref": parentId}, {session: this.repository.getSession()}).toArray();
    }
    
    async deleteAllByParent(parentId: types.resource.ResourceId) {
        return this.repository.collection.deleteMany({"acl.ref": parentId}, {session: this.repository.getSession()});
    }
    
    generateId() {
        return this.repository.generateId();
    }
    
    async insert(resource: db.resource.Resource) {
        await this.repository.insert(resource);
    }
    
    async increaseStats(id: types.resource.ResourceId, type: types.resource.ResourceType, lastDate: types.core.Timestamp) {
        await this.repository.collection.updateOne({_id: id}, {$inc: {[`stats.${type}.count`]: 1}, $max: {[`stats.${type}.lastDate`]: lastDate}}, {upsert: true, session: this.repository.getSession()});
    }
    
    async decreaseStats(id: types.resource.ResourceId, type: types.resource.ResourceType, lastDate: types.core.Timestamp) {
        await this.repository.collection.updateOne({_id: id}, {$inc: {[`stats.${type}.count`]: -1}, $max: {[`stats.${type}.lastDate`]: lastDate}}, {upsert: true, session: this.repository.getSession()});
    }
    
    async delete(id: types.resource.ResourceId) {
        return this.repository.delete(id);
    }
}
