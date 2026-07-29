/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IStorageService } from "../misc/StorageService";

export class StorageServiceProvider {
    
    constructor(
        private storageService: IStorageService,
        private randomWriteStorageService: IStorageService,
    ) {}
    
    getRegularStorageService() {
        return this.storageService;
    }
    
    getRandomWriteStorageService() {
        return this.randomWriteStorageService;
    }
    
    getStorageService(type: "regular"|"randomWrite") {
        return type === "regular" ? this.storageService : this.randomWriteStorageService;
    }
}
