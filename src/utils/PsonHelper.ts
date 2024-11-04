/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { StaticPair } from "pson";
import * as ByteBuffer from "bytebuffer";

export class PsonHelper {
    
    static INSTANCE = new PsonHelper();
    
    encoders: {[key: string]: StaticPair};
    
    constructor() {
        this.encoders = {};
    }
    
    get_encoder(dict: string[]) {
        const key = dict.join("");
        if (!(key in this.encoders)) {
            this.encoders[key] = new StaticPair(dict);
        }
        return this.encoders[key];
    }
    
    pson_encode(obj: any, dict: string[] = []): Buffer {
        return Buffer.from(this.get_encoder(dict).encode(obj).toArrayBuffer());
    }
    
    pson_decode<T = any>(bin: Buffer, dict: string[] = []): T {
        return this.get_encoder(dict).decode(bin);
    }
    
    pson_decodeEx<T = any>(bin: Buffer, dict: string[] = []): T {
        const res = this.pson_decode(bin, dict);
        return this.convertByteBuffer(res);
    }
    
    convertByteBuffer(input: any): any {
        if (input != null && typeof(input) == "object") {
            if (input instanceof ByteBuffer) {
                return input.toBuffer();
            }
            if (Array.isArray(input)) {
                return input.map(x => this.convertByteBuffer(x));
            }
            const res: any = {};
            for (const key in input) {
                res[key] = this.convertByteBuffer(input[key]);
            }
            return res;
        }
        return input;
    }
}
