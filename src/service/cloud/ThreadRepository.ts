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

export class ThreadRepository {
    
    static readonly COLLECTION_NAME = "thread";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.thread.ThreadId, db.thread.Thread>,
    ) {
    }
    
    async get(id: types.thread.ThreadId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.thread.ThreadId[]) {
        return this.repository.getMulti(ids);
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (thread: db.thread.Thread) => Promise<void>) {
        while (true) {
            const threads = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (threads.length === 0) {
                return;
            }
            for (const thread of threads) {
                await this.deleteThread(thread.id);
                await func(thread);
            }
        }
    }
    
    async getPageByContextAndUser(contextId: types.context.ContextId, type: types.thread.ThreadType|undefined, userId: types.cloud.UserId, solutionId: types.cloud.SolutionId|undefined, listParams: types.core.ListModel, sortBy: keyof db.thread.Thread, scope: types.core.ContainerAccessScope, userGroupIds: types.group.GroupId[] = []) {
        if (!solutionId) {
            return this.repository.matchX({contextId: contextId, users: userId}, listParams, sortBy);
        }
        return this.repository.getMatchingPage([
            ...ContextRepository.getPaginationFilterForContainer(contextId, userId, listParams.query, type, scope, userGroupIds),
        ], listParams, sortBy);
    }
    
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel2<types.thread.ThreadId>) {
        return this.repository.matchX2({contextId: contextId}, listParams);
    }
    
    async getAllThreads(contextId: types.context.ContextId, type: types.thread.ThreadType|undefined, listParams: types.core.ListModel, sortBy: keyof db.thread.Thread) {
        const match: Record<string, unknown> = {
            contextId: contextId,
        };
        if (type) {
            match.type = type;
        }
        return await this.repository.getMatchingPage<db.thread.Thread>([{$match: match}], listParams, sortBy);
    }
    
    async createThread(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.thread.ThreadType|undefined, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.thread.ThreadData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy, grantees?: types.cloud.ContainerGrantees) {
        const groups = grantees?.groups || [];
        const entry: db.thread.ThreadHistoryEntry = {
            created: DateUtils.now(),
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groups: groups,
        };
        const thread: db.thread.Thread = {
            id: this.repository.generateId(),
            contextId: contextId,
            type: type,
            creator: entry.author,
            createDate: entry.created,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            groups: groups,
            groupKeys: grantees?.groupKeys || [],
            history: [entry],
            allTimeUsers: Utils.uniqueFromArrays(entry.users, entry.managers),
            lastMsgDate: entry.created,
            messages: 0,
            policy: policy,
        };
        if (resourceId) {
            thread.clientResourceId = resourceId;
        }
        await this.repository.insert(thread);
        return thread;
    }
    
    async updateThread(oldThread: db.thread.Thread, modifier: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.thread.ThreadData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null, grantees?: types.cloud.ContainerGrantees) {
        const groups = grantees?.groups || [];
        const entry: db.thread.ThreadHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groups: groups,
        };
        const updatedThread: db.thread.Thread = {
            id: oldThread.id,
            contextId: oldThread.contextId,
            type: oldThread.type,
            creator: oldThread.creator,
            createDate: oldThread.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            keeper: entry.author,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            groups: groups,
            groupKeys: grantees?.groupKeys || [],
            history: [...oldThread.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldThread.allTimeUsers, entry.users, entry.managers),
            lastMsgDate: oldThread.lastMsgDate,
            messages: oldThread.messages,
            policy: policy === undefined ? oldThread.policy : policy,
        };
        if (resourceId && !oldThread.clientResourceId) {
            updatedThread.clientResourceId = resourceId;
        }
        else if (oldThread.clientResourceId) {
            updatedThread.clientResourceId = oldThread.clientResourceId;
        }
        await this.repository.update(updatedThread);
        return updatedThread;
    }
    
    async rotateKeys(oldThread: db.thread.Thread, modifier: types.cloud.UserId,
        newKeyId: types.core.KeyId, newKeys: types.cloud.UserKeysEntry[], grantees?: types.cloud.ContainerGrantees) {
        // History entry keeps OLD keyId/data so the DIO (signed by oldThread.lastModifier
        // at oldThread.lastModificationDate) remains verifiable by the endpoint.
        const groups = grantees?.groups || oldThread.groups || [];
        const entry: db.thread.ThreadHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: oldThread.keyId,
            data: oldThread.data,
            users: oldThread.users,
            managers: oldThread.managers,
            groups: groups,
        };
        const updatedThread: db.thread.Thread = {
            ...oldThread,
            keyId: newKeyId,
            keeper: modifier,
            keys: newKeys,
            groups: groups,
            groupKeys: grantees?.groupKeys || [],
            history: [...oldThread.history, entry],
            // lastModifier / lastModificationDate intentionally NOT updated
        };
        await this.repository.update(updatedThread);
        return updatedThread;
    }
    
    async deleteThread(id: types.thread.ThreadId) {
        return this.repository.delete(id);
    }
    
    /** True if any thread still grants access to the given group (Phase 2 referential integrity). */
    async isGroupReferenced(groupId: types.group.GroupId): Promise<boolean> {
        const found = await this.repository.query(q => q.arrayProp("groups").eq("groupId", groupId)).limit(1).array();
        return found.length > 0;
    }
    
    async deleteManyThreads(ids: types.thread.ThreadId[]) {
        return this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async increaseMessageCounter(threadId: types.thread.ThreadId, lastMsgDate: types.core.Timestamp) {
        await this.repository.collection.updateOne({_id: threadId}, {$inc: {messages: 1}, $max: {lastMsgDate: lastMsgDate}}, {session: this.repository.getSession()});
    }
    
    async decreaseMessageCounter(threadId: types.thread.ThreadId, lastMsgDate: types.core.Timestamp, decrease?: number) {
        await this.repository.collection.updateOne({_id: threadId}, {$inc: {messages: (decrease) ? -decrease : -1}, $set: {lastMsgDate: lastMsgDate}}, {session: this.repository.getSession()});
    }
    
    async getThreadStats(threadId: types.thread.ThreadId) {
        return this.repository.query(q => q.eq("id", threadId)).props("id", "messages", "lastMsgDate").one();
    }
}
