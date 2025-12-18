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
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import { ContextRepository } from "./ContextRepository";

export class InboxRepository {
    
    static readonly COLLECTION_NAME = "inbox";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.inbox.InboxId, db.inbox.Inbox>,
    ) {
    }
    
    async get(id: types.inbox.InboxId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.inbox.InboxId[]) {
        return this.repository.getMulti(ids);
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (inbox: db.inbox.Inbox) => Promise<void>) {
        while (true) {
            const inboxes = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (inboxes.length === 0) {
                return;
            }
            for (const inbox of inboxes) {
                await this.deleteInbox(inbox.id);
                await func(inbox);
            }
        }
    }
    
    async getAllInboxes(contextId: types.context.ContextId, type: types.inbox.InboxType|undefined, listParams: types.core.ListModel, sortBy: keyof db.inbox.Inbox) {
        const match: Record<string, unknown> = {
            contextId: contextId,
        };
        if (type) {
            match.type = type;
        }
        return await this.repository.getMatchingPage<db.inbox.Inbox>([{$match: match}], listParams, sortBy);
    }
    
    async getPageByContextAndUser(contextId: types.context.ContextId, type: types.inbox.InboxType|undefined, userId: types.cloud.UserId, solutionId: types.cloud.SolutionId|undefined, listParams: types.core.ListModel, sortBy: keyof db.inbox.Inbox, scope: types.core.ContainerAccessScope) {
        if (!solutionId) {
            return this.repository.matchX({contextId: contextId, users: userId}, listParams, sortBy);
        }
        return this.repository.getMatchingPage([
            ...ContextRepository.getPaginationFilterForContainer(solutionId, contextId, userId, listParams.query, type, scope),
        ], listParams, sortBy);
    }
    
    async getPageByContext(contextId: types.context.ContextId, listParams: types.core.ListModel2<types.inbox.InboxId>) {
        return this.repository.matchX2({contextId: contextId}, listParams);
    }
    
    async createInbox(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.inbox.InboxType|undefined, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[], data: types.inbox.InboxData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerWithoutItemPolicy) {
        const entry: db.inbox.InboxHistoryEntry = {
            created: DateUtils.now(),
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const inbox: db.inbox.Inbox = {
            id: this.repository.generateId(),
            contextId: contextId,
            type: type,
            creator: entry.author,
            createDate: entry.created,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data.meta,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [entry],
            allTimeUsers: Utils.uniqueFromArrays(entry.users, entry.managers),
            policy: policy,
        };
        if (resourceId) {
            inbox.clientResourceId = resourceId;
        }
        await this.repository.insert(inbox);
        return inbox;
    }
    
    async updateInbox(oldInbox: db.inbox.Inbox, modifier: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[], data: types.inbox.InboxData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerWithoutItemPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const entry: db.inbox.InboxHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const updatedInbox: db.inbox.Inbox = {
            id: oldInbox.id,
            contextId: oldInbox.contextId,
            type: oldInbox.type,
            creator: oldInbox.creator,
            createDate: oldInbox.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data.meta,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [...oldInbox.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldInbox.allTimeUsers, entry.users, entry.managers),
            policy: policy === undefined ? oldInbox.policy : policy,
        };
        if (resourceId && !oldInbox.clientResourceId) {
            updatedInbox.clientResourceId = resourceId;
        }
        else if (oldInbox.clientResourceId) {
            updatedInbox.clientResourceId = oldInbox.clientResourceId;
        }
        await this.repository.update(updatedInbox);
        return updatedInbox;
    }
    
    async deleteInbox(id: types.inbox.InboxId) {
        await this.repository.delete(id);
    }
    
    async deleteManyInboxes(ids: types.inbox.InboxId[]) {
        await this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async getInboxesWithThread(threadId: types.thread.ThreadId) {
        return await this.repository.findAll(q => q.arrayProp("history").prop("data").eq("threadId", threadId));
    }
    
    async getInboxesWithStore(storeId: types.store.StoreId) {
        return await this.repository.findAll(q => q.arrayProp("history").prop("data").eq("storeId", storeId));
    }
}
