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
import { AppException } from "../../api/AppException";
import { DateUtils } from "../../utils/DateUtils";

export class RequestRepository {
    
    static readonly COLLECTION_NAME = "request";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.request.RequestId, db.request.Request>,
    ) {
    }
    
    async getWithAccessCheck(user: types.core.Username, requestId: types.request.RequestId) {
        const request = await this.repository.get(requestId);
        if (!request) {
            throw new AppException("REQUEST_DOES_NOT_EXIST");
        }
        if (request.author !== user) {
            throw new AppException("ACCESS_DENIED");
        }
        return request;
    }
    
    async create(user: types.core.Username, files: types.request.FileDefinition[]) {
        const req: db.request.Request = {
            id: this.repository.generateId(),
            author: user,
            created: DateUtils.now(),
            modified: DateUtils.now(),
            processing: false,
            files: files.map(x => {
                const f: db.request.FileDefinition = {
                    id: <types.request.FileId><string>this.repository.generateId(),
                    seq: 0,
                    sent: 0,
                    size: x.size,
                    checksumSize: x.checksumSize,
                    checksumSent: 0,
                    closed: false
                };
                return f;
            })
        };
        await this.repository.insert(req);
        return req;
    }
    
    async getReadyForUser(user: types.core.Username, requestId: types.request.RequestId) {
        const request = await this.getWithAccessCheck(user, requestId);
        for (const f of request.files) {
            if (!f.closed) {
                throw new AppException("REQUEST_NOT_READY_YET");
            }
        }
        return request;
    }
    
    async markRequestAsProcessing(requestId: types.request.RequestId) {
        const oldReq = await this.repository.get(requestId);
        if (!oldReq) {
            throw new AppException("REQUEST_DOES_NOT_EXIST");
        }
        const newReq: db.request.Request = {
            ...oldReq,
            modified: DateUtils.now(),
            processing: true,
        };
        await this.repository.update(newReq);
        return newReq;
    }
    
    async addChunk(oldReq: db.request.Request, fileIndex: number, chunkLength: number) {
        const newReq: db.request.Request = {
            id: oldReq.id,
            author: oldReq.author,
            created: oldReq.created,
            modified: DateUtils.now(),
            processing: false,
            files: oldReq.files.map((x, i) => {
                if (i === fileIndex) {
                    return {
                        id: x.id,
                        seq: x.seq + 1,
                        size: x.size,
                        checksumSize: x.checksumSize,
                        sent: x.sent + chunkLength,
                        checksumSent: x.checksumSent,
                        closed: false
                    };
                }
                return x;
            }),
        };
        await this.repository.update(newReq);
        return newReq;
    }
    
    async commitFile(oldReq: db.request.Request, fileIndex: number, checksumLength: number) {
        const newReq: db.request.Request = {
            id: oldReq.id,
            author: oldReq.author,
            created: oldReq.created,
            modified: DateUtils.now(),
            processing: false,
            files: oldReq.files.map((x, i) => {
                if (i === fileIndex) {
                    return {
                        id: x.id,
                        seq: x.seq,
                        size: x.size,
                        checksumSize: x.checksumSize,
                        sent: x.sent,
                        checksumSent: checksumLength,
                        closed: true
                    };
                }
                return x;
            }),
        };
        await this.repository.update(newReq);
        return newReq;
    }
    
    async deleteWithAccessCheck(user: types.core.Username, requestId: types.request.RequestId) {
        await this.getWithAccessCheck(user, requestId);
        await this.delete(requestId);
    }
    
    async delete(requestId: types.request.RequestId) {
        await this.repository.delete(requestId);
    }
    
    async clearExpired(maxInactiveTime: types.core.Timespan) {
        const minModDate = DateUtils.nowSub(maxInactiveTime);
        const requests = await this.repository.findAll(q => q.and(
            q.eq("processing", false),
            q.lt("modified", minModDate)
        ));
        for (const request of requests) {
            await this.repository.delete(request.id);
        }
        return requests;
    }
}
