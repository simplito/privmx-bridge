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

export class ManagementStoreApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();

        this.registerMethod("getStore", this.builder.createObject({
            storeId: this.tv.storeId,
        }));
        
        this.registerMethod("listStores", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            from: this.builder.nullable(this.tv.storeId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteStore", this.builder.createObject({
            storeId: this.tv.storeId,
        }));
        
        this.registerMethod("deleteManyStores", this.builder.createObject({
            storeIds: this.builder.createListWithMaxLength(this.tv.storeId, 128),
        }));

        this.registerMethod("getStoreFile", this.builder.createObject({
            storeFileId: this.tv.storeFileId,
        }));
        
        this.registerMethod("listStoreFiles", this.builder.createObject({
            storeId: this.tv.storeId,
            from: this.builder.nullable(this.tv.storeFileId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteStoreFile", this.builder.createObject({
            storeFileId: this.tv.storeFileId,
        }));
        
        this.registerMethod("deleteManyStoreFiles", this.builder.createObject({
            fileIds: this.builder.createListWithMaxLength(this.tv.storeFileId, 128),
        }));

        this.registerMethod("deleteStoreFilesOlderThan", this.builder.createObject({
            storeId: this.tv.storeId,
            timestamp: this.tv.timestamp,
        }));
    }
}
