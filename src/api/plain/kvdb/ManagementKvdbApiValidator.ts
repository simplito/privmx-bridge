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

export class ManagementKvdbApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getKvdb", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
        }));
        
        this.registerMethod("listKvdbs", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            from: this.builder.nullable(this.tv.kvdbId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteKvdb", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
        }));
        
        this.registerMethod("deleteManyKvdbs", this.builder.createObject({
            kvdbIds: this.builder.createListWithMaxLength(this.tv.kvdbId, 128),
        }));
        
        this.registerMethod("getKvdbEntry", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKey: this.tv.kvdbEntryKey,
        }));
        
        this.registerMethod("deleteKvdbEntry", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKey: this.tv.kvdbEntryKey,
        }));
        
        this.registerMethod("deleteManyKvdbEntries", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKeys: this.builder.createListWithMaxLength(this.tv.kvdbEntryKey, 128),
        }));
        
        this.registerMethod("listKvdbKeys", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            from: this.builder.nullable(this.tv.kvdbEntryKey),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("listKvdbEntries", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            from: this.builder.nullable(this.tv.kvdbEntryKey),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
            prefix: this.builder.optional(this.builder.maxLength(this.builder.string, 256)),
        }));
    }
}
