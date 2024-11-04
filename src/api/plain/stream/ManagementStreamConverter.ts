/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as managementStreamApi from "./ManagementStreamApiTypes";
import * as db from "../../../db/Model";

export class ManagementStreamConverter {
    
    convertStreamRoom(x: db.stream.StreamRoom) {
        const res: managementStreamApi.StreamRoom = {
            id: x.id,
            contextId: x.contextId,
            createDate: x.createDate,
            creator: x.creator,
            lastModificationDate: x.lastModificationDate,
            lastModifier: x.lastModifier,
            users: x.users,
            managers: x.managers,
            keyId: x.keyId,
            version: <types.stream.StreamRoomVersion>x.history.length,
        };
        return res;
    }
}
