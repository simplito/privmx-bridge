/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IOC } from "../../service/ioc/IOC";
import { MigrationId } from "./MigrationManager";

interface ApiKey{
    id: string;
    created: number;
    user: string;
    enabled: boolean;
    name: string;
    secret: string;
    scopes: string[];
    masterKey: boolean;
    publicKey?: string;
}

export class Migration059ApiKeyScopes {
    
    static id = <MigrationId>"Migration_059_ApiKeyScopes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const apiKeyCollection = await dbManager.createOrGetCollection<ApiKey>("api_key");
        const apiKeyArray = await apiKeyCollection.find({}).toArray();
        for (const apiKey of apiKeyArray) {
            await apiKeyCollection.updateOne({
                _id: apiKey._id,
            },
            {
                $set: {
                    scopes: ["context", "apiKey", "solution", "solution:*", "inbox", "store", "thread", "stream"],
                    masterKey: true,
                },
            });
        }
    }
}
