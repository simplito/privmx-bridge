/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as streamApi from "./StreamApiTypes";
import * as db from "../../../db/Model";

export class StreamConverter {
    
    convertStreamRoom(user: types.cloud.UserId, stream: db.stream.StreamRoom) {
        const res: streamApi.StreamRoom = {
            id: stream.id,
            contextId: stream.contextId,
            createDate: stream.createDate,
            creator: stream.creator,
            lastModificationDate: stream.lastModificationDate,
            lastModifier: stream.lastModifier,
            users: stream.users,
            managers: stream.managers,
            keyId: stream.keyId,
            data: stream.history.map(x => ({keyId: x.keyId, data: x.data})),
            keys: (stream.keys.find(x => x.user === user)?.keys) || [],
            version: <types.stream.StreamRoomVersion>stream.history.length,
            type: stream.type,
            policy: stream.policy || {},
        };
        if (stream.clientResourceId) {
            res.resourceId = stream.clientResourceId;
        }
        return res;
    }
}
