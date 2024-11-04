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

export class UserApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("ping", this.builder.empty);
        
        this.registerMethod("authorizeWebSocket", this.builder.createObject({
            key: this.builder.length(this.tv.base64, 32),
            addWsChannelId: this.builder.nullableOptional(this.builder.bool)
        }));
        
        this.registerMethod("unauthorizeWebSocket", this.builder.empty);
        
        this.registerMethod("subscribeToChannel", this.builder.createObject({
            channel: this.tv.wsChannel
        }));
        
        this.registerMethod("unsubscribeFromChannel", this.builder.createObject({
            channel: this.tv.wsChannel
        }));
        
        this.registerMethod("logout", this.builder.empty);
    }
}
