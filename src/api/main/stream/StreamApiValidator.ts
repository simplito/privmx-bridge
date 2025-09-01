/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class StreamApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("streamRoomCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.streamRoomData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        
        this.registerMethod("streamRoomUpdate", this.builder.createObject({
            id: this.tv.streamRoomId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.streamRoomData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        
        this.registerMethod("streamRoomDelete", this.builder.createObject({
            id: this.tv.streamRoomId,
        }));
        
        this.registerMethod("streamRoomDeleteMany", this.builder.createObject({
            ids: this.builder.createListWithMaxLength(this.tv.streamRoomId, 128),
        }));
        
        this.registerMethod("streamRoomGet", this.builder.createObject({
            id: this.tv.streamRoomId,
            type: this.tv.optResourceType,
        }));
        
        this.registerMethod("streamRoomList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        
        this.registerMethod("streamRoomListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        
        this.registerMethod("streamRoomSendCustomEvent", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            channel: this.tv.wsChannelName,
            keyId: this.tv.keyId,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384)),
        }));
    }
}
