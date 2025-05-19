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

export class ThreadMessageRepository {
    
    static readonly COLLECTION_NAME = "threadMessage";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.thread.ThreadMessageId, db.thread.ThreadMessage>,
    ) {
    }
    
    async get(id: types.thread.ThreadMessageId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.thread.ThreadMessageId[]) {
        return this.repository.getMulti(ids);
    }
    
    async getMessagesOlderThan(id: types.thread.ThreadId, timestamp: types.core.Timestamp) {
        return this.repository.findAll(q => q.and(
            q.lt("createDate", timestamp),
            q.eq("threadId", id),
        ));
    }
    
    async getPageByThreadAndUser(userId: types.cloud.UserId, threadId: types.thread.ThreadId, listParams: types.core.ListModel) {
        const sortBy = "createDate";
        const match: Record<string, unknown> = {
            $and: [
                {
                    threadId: threadId,
                },
                {
                    author: userId,
                },
            ],
        };
        return this.repository.matchX(match, listParams, sortBy);
    }
    
    async getPageByThread(threadId: types.thread.ThreadId, listParams: types.core.ListModel) {
        const sortBy = "createDate";
        return this.repository.matchX({threadId: threadId}, listParams, sortBy);
    }
    
    async getPageByThreadMatch2(threadId: types.thread.ThreadId, listParams: types.core.ListModel2<types.thread.ThreadMessageId>) {
        return this.repository.matchX2({threadId: threadId}, listParams);
    }
    
    generateMsgId() {
        return this.repository.generateId();
    }
    
    async tryCreateMessage(msgId: types.thread.ThreadMessageId|null, author: types.cloud.UserId, threadId: types.thread.ThreadId, data: types.thread.ThreadMessageData, keyId: types.core.KeyId, resourceId: types.core.ClientResourceId|null) {
        const message: db.thread.ThreadMessage = {
            id: msgId ? msgId : this.repository.generateId(),
            threadId: threadId,
            createDate: DateUtils.now(),
            author: author,
            data: data,
            keyId: keyId,
        };
        if (resourceId) {
            message.clientResourceId = resourceId;
        }
        await this.repository.insert(message);
        return message;
    }
    
    async updateMessage(oldMessage: db.thread.ThreadMessage, author: types.cloud.UserId, data: types.thread.ThreadMessageData, keyId: types.core.KeyId, resourceId: types.core.ClientResourceId|null) {
        const updates = oldMessage.updates || [];
        updates.push({
            createDate: DateUtils.now(),
            author: author,
        });
        const message: db.thread.ThreadMessage = {
            id: oldMessage.id,
            threadId: oldMessage.threadId,
            createDate: oldMessage.createDate,
            author: oldMessage.author,
            data: data,
            keyId: keyId,
            updates: updates,
        };
        if (resourceId && !oldMessage.clientResourceId) {
            message.clientResourceId = resourceId;
        }
        else if (oldMessage.clientResourceId) {
            message.clientResourceId = oldMessage.clientResourceId;
        }
        await this.repository.update(message);
        return message;
    }
    
    async deleteAllFromThread(threadId: types.thread.ThreadId) {
        await this.repository.deleteMany(q => q.eq("threadId", threadId));
    }
    
    async deleteAllFromThreads(threadIds: types.thread.ThreadId[]) {
        await this.repository.deleteMany(q => q.in("threadId", threadIds));
    }
    
    async deleteMessage(id: types.thread.ThreadMessageId) {
        await this.repository.delete(id);
    }
    
    async deleteManyMessages(ids: types.thread.ThreadMessageId[]) {
        return this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async getLastMessageDate(threadId: types.thread.ThreadId) {
        const list = await this.repository.query(q => q.eq("threadId", threadId)).props("createDate").sort("createDate", false).limit(1).array();
        return list.length === 0 ? null : list[0].createDate;
    }
}
