/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PsonHelper } from "./PsonHelper";

export class PsonHelperEx {
    
    psonHelper: PsonHelper;
    
    constructor(private dict: string[]) {
        this.psonHelper = new PsonHelper();
    }
    
    pson_encode(obj: any): Buffer {
        return this.psonHelper.pson_encode(obj, this.dict);
    }
    
    pson_decode<T = any>(bin: Buffer): T {
        return this.psonHelper.pson_decode(bin, this.dict);
    }
    
    pson_decodeEx<T = any>(bin: Buffer): T {
        return this.psonHelper.pson_decodeEx(bin, this.dict);
    }
}