/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as managementThreadApi from "./ManagementThreadApiTypes";
import * as db from "../../../db/Model";
import { Utils } from "../../../utils/Utils";

export class ManagementThreadConverter {
    
    convertThread(x: db.thread.Thread) {
        const res: managementThreadApi.Thread = {
            id: x.id,
            contextId: x.contextId,
            createDate: x.createDate,
            creator: x.creator,
            lastModificationDate: x.lastModificationDate,
            lastModifier: x.lastModifier,
            keyId: x.keyId,
            users: x.users,
            managers: x.managers,
            version: x.history.length as types.thread.ThreadVersion,
            lastMsgDate: x.lastMsgDate,
            messages: x.messages,
            publicMeta: Utils.findFieldInUnknownObject(x.data, "publicMetaObject"),
        };
        return res;
    }
    
    convertThreadMessage(thread: db.thread.Thread, x: db.thread.ThreadMessage) {
        const res: managementThreadApi.ThreadMessage = {
            id: x.id,
            contextId: thread.contextId,
            threadId: x.threadId,
            createDate: x.createDate,
            author: x.author,
            keyId: x.keyId,
            publicMeta: Utils.findFieldInUnknownObject(x.data, "publicMetaObject"),
        };
        return res;
    }
}
