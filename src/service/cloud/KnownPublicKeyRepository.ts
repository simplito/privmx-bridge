/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as db from "../../db/Model";
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import { DateUtils } from "../../utils/DateUtils";

export class KnownPublicKeyRepository {
    
    static readonly COLLECTION_NAME = "knownPublicKey";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.cloud.KnownKeyId, db.solution.KnownPublicKey>,
    ) {
    }
    
    async upsertKeyStatus(host: types.core.Host, solutionId: types.cloud.SolutionId, userPubKey: types.cloud.UserPubKey, action: types.cloud.KnownKeyStatus) {
        const now = DateUtils.now();
        await this.repository.col().updateOne(
            {
                _id: this.buildKeyId(host, solutionId, userPubKey),
            },
            {
                $set: {
                    solutionId: solutionId,
                    publicKey: userPubKey,
                    lastStatusChange: {
                        action: action,
                        timestamp: now,
                    },
                },
            },
            {
                upsert: true,
            },
        );
    }
    
    private buildKeyId(host: types.core.Host, solutionId: types.cloud.SolutionId, userPubKey: types.cloud.UserPubKey) {
        return `${host}/${solutionId}/${userPubKey}` as types.cloud.KnownKeyId;
    }
}
