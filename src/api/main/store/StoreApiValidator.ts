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

export class StoreApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("storeCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            data: this.tv.storeData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 128),
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        this.registerMethod("storeUpdate", this.builder.createObject({
            id: this.tv.storeId,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 128),
            data: this.tv.storeData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 128),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        this.registerMethod("storeDelete", this.builder.createObject({
            storeId: this.tv.storeId,
        }));
        this.registerMethod("storeDeleteMany", this.builder.createObject({
            storeIds: this.builder.createListWithMaxLength(this.tv.storeId, 128),
        }));
        this.registerMethod("storeGet", this.builder.createObject({
            storeId: this.tv.storeId,
            type: this.tv.optResourceType,
        }));
        this.registerMethod("storeList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate", "lastFileDate"])),
        }));
        this.registerMethod("storeListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate", "lastFileDate"])),
        }));
        this.registerMethod("storeFileGet", this.builder.createObject({
            fileId: this.tv.storeFileId,
        }));
        this.registerMethod("storeFileGetMany", this.builder.createObject({
            storeId: this.tv.storeId,
            fileIds: this.builder.createListWithMaxLength(this.tv.storeFileId, 100),
            failOnError: this.builder.bool,
        }));
        this.registerMethod("storeFileList", this.builder.addFields(this.tv.listModel, {
            storeId: this.tv.storeId,
        }));
        this.registerMethod("storeFileListMy", this.builder.addFields(this.tv.listModel, {
            storeId: this.tv.storeId,
        }));
        this.registerMethod("storeFileCreate", this.builder.createObject({
            storeId: this.tv.storeId,
            requestId: this.tv.requestId,
            fileIndex: this.builder.int,
            meta: this.tv.storeFileMeta,
            keyId: this.tv.keyId,
            thumbIndex: this.builder.optional(this.builder.int),
        }));
        this.registerMethod("storeFileRead", this.builder.createObject({
            fileId: this.tv.storeFileId,
            thumb: this.builder.bool,
            version: this.builder.optional(this.tv.intNonNegative),
            range: this.tv.bufferReadRange,
        }));
        this.registerMethod("storeFileWrite", this.builder.createObject({
            fileId: this.tv.storeFileId,
            requestId: this.tv.requestId,
            fileIndex: this.builder.int,
            meta: this.tv.storeFileMeta,
            keyId: this.tv.keyId,
            thumbIndex: this.builder.optional(this.builder.int),
        }));
        this.registerMethod("storeFileUpdate", this.builder.createObject({
            fileId: this.tv.storeFileId,
            meta: this.tv.storeFileMeta,
            keyId: this.tv.keyId,
        }));
        this.registerMethod("storeFileDelete", this.builder.createObject({
            fileId: this.tv.storeFileId,
        }));
        this.registerMethod("storeFileDeleteMany", this.builder.createObject({
            fileIds: this.builder.createListWithMaxLength(this.tv.storeFileId, 128),
        }));
        this.registerMethod("storeFileDeleteOlderThan", this.builder.createObject({
            storeId: this.tv.storeId,
            timestamp: this.tv.timestamp,
        }));
        this.registerMethod("storeSendCustomEvent", this.builder.createObject({
            storeId: this.tv.storeId,
            channel: this.tv.wsChannelName,
            keyId: this.tv.keyId,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, 128)),
        }));
    }
}
