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

export class RequestApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getRequestConfig",  this.builder.empty);
        
        this.registerMethod("createRequest", this.builder.createObject({
            files: this.builder.createList(this.builder.createObject({
                size: this.tv.intNonNegative,
                checksumSize: this.tv.intNonNegative,
            })),
        }));
        
        this.registerMethod("destroyRequest", this.builder.createObject({
            id: this.tv.requestId,
        }));
        
        this.registerMethod("sendChunk", this.builder.createObject({
            requestId: this.tv.requestId,
            fileIndex: this.builder.int,
            seq: this.builder.int,
            data: this.tv.byteBuffer,
        }));
        
        this.registerMethod("commitFile", this.builder.createObject({
            requestId: this.tv.requestId,
            fileIndex: this.builder.int,
            seq: this.builder.int,
            checksum: this.tv.byteBuffer,
        }));
    }
}
