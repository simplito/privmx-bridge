/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../../api/BaseValidator";

export class InitApiValidator extends BaseValidator {
    
    constructor() {
        super();
        
        this.registerMethod("versions", this.builder.empty);
    }
}
