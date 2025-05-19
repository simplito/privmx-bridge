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

export class KvdbApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("kvdbCreate", this.builder.createObject({
            resourceId: this.tv.uuidv4,
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            data: this.tv.kvdbData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 128),
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        
        this.registerMethod("kvdbUpdate", this.builder.createObject({
            id: this.tv.kvdbId,
            resourceId: this.tv.uuidv4,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            data: this.tv.kvdbData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 128),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        
        this.registerMethod("kvdbDelete", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
        }));
        
        this.registerMethod("kvdbDeleteMany", this.builder.createObject({
            kvdbIds: this.builder.createListWithMaxLength(this.tv.kvdbId, 128),
        }));
        
        this.registerMethod("kvdbGet", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            type: this.tv.optResourceType,
        }));
        
        this.registerMethod("kvdbList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate"])),
        }));
        
        this.registerMethod("kvdbListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate"])),
        }));
        
        this.registerMethod("kvdbEntrySet", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKey: this.tv.kvdbEntryKey,
            kvdbEntryValue: this.tv.unknown16Kb,
            keyId: this.tv.keyId,
            version: this.builder.optional(this.builder.min(this.builder.int, 0)),
            force: this.builder.optional(this.builder.bool),
        }));
        
        this.registerMethod("kvdbEntryDelete", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKey: this.tv.kvdbEntryKey,
        }));
        
        this.registerMethod("kvdbEntryGet", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKey: this.tv.kvdbEntryKey,
        }));
        
        this.registerMethod("kvdbListKeys", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            skip: this.tv.intNonNegative,
            limit: this.builder.range(this.builder.int, 1, 100),
            sortOrder: this.builder.createEnum(["asc", "desc"]),
        }));
        
        this.registerMethod("kvdbListEntries", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            skip: this.tv.intNonNegative,
            limit: this.builder.range(this.builder.int, 1, 100),
            sortOrder: this.builder.createEnum(["asc", "desc"]),
            prefix: this.builder.optional(this.builder.maxLength(this.builder.string, 256)),
            lastKey: this.builder.optional(this.builder.maxLength(this.builder.string, 256)),
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "entryKey", "lastModificationDate"])),
            query: this.builder.optional(this.tv.dbQuery),
        }));
        
        this.registerMethod("kvdbEntryDeleteMany", this.builder.createObject({
            kvdbId: this.tv.kvdbId,
            kvdbEntryKeys: this.builder.createListWithMaxLength(this.tv.kvdbEntryKey, 128),
        }));
    }
}
