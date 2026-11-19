/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as contextApi from "./ContextApiTypes";
import * as types from "../../../types";
import type { SpaceView } from "../../../service/cloud/SpaceService";

export class SpaceConverter {
    
    static convertSpace(view: SpaceView): contextApi.SpaceInfo {
        const space = view.space;
        return {
            id: space.id,
            resourceId: space.clientResourceId,
            contextId: space.contextId,
            creator: space.creator,
            createDate: space.createDate,
            lastModifier: space.lastModifier,
            lastModificationDate: space.lastModificationDate,
            groups: space.groups,
            users: space.users,
            keyId: space.keyId,
            keyVersion: space.keyVersion,
            keyIsStale: view.keyIsStale,
            keys: view.keys.map(k => {
                const entry: types.cloud.SpaceKeyEntry = {
                    keyVersion: k.keyVersion,
                    recipient: k.groupId !== undefined ? {groupId: k.groupId, groupKeyVersion: k.groupKeyVersion!} : {userId: k.userId!},
                    data: k.data,
                    signature: k.signature,
                };
                return entry;
            }),
            publicMeta: space.publicMeta,
            privateMeta: space.privateMeta,
            publicMetaVersion: space.publicMetaVersion,
            privateMetaVersion: space.privateMetaVersion,
        };
    }
}
