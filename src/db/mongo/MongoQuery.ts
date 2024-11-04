/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseQuery } from "../BaseQuery";
import { Query } from "../ObjectRepository";

export class MongoQuery<T> extends BaseQuery<T> {
    
    constructor(private idProperty: keyof T, baseName: string = "") {
        super(baseName);
    }
    
    protected getPropName(prop: keyof T): string {
        if (prop == this.idProperty) {
            return "_id";
        }
        return (this.baseName ? this.baseName + "." : "") + <string>prop;
    }
    
    protected create<K extends keyof T, Q>(prop: K): Query<Q> {
        return new MongoQuery(<any>"", this.getPropName(prop));
    }
}
