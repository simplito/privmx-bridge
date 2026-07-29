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

export class ContextApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("contextGet", this.builder.createObject({
            id: this.tv.cloudContextId,
        }));
        this.registerMethod("contextList", this.builder.addFields(this.tv.listModel, {
            appPubKey: this.builder.optional(this.tv.eccPub),
        }));
        this.registerMethod("contextSendCustomEvent", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            channel: this.tv.wsChannelName,
            data: this.tv.unknown16Kb,
            users: this.builder.createList(this.builder.createObject({
                id: this.tv.cloudUserId,
                key: this.tv.userKeyData,
            })),
        }));
        this.registerMethod("contextGetUsers", this.builder.createObject({
            contextId: this.tv.cloudContextId,
        }));
        this.registerMethod("contextListUsers", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
        }));
    }
}
