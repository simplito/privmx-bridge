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

export class ManagementStreamApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getStreamRoom", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        
        this.registerMethod("listStreamRooms", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            from: this.builder.nullable(this.tv.streamRoomId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteStreamRoom", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        
        this.registerMethod("deleteManyStreamRooms", this.builder.createObject({
            streamRoomIds: this.builder.createListWithMaxLength(this.tv.streamRoomId, 128),
        }));
    }
}
