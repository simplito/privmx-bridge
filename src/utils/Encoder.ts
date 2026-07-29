/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import { Unpackr, Packr } from "msgpackr";
import { PsonHelperEx } from "./PsonHelperEx";

export class EncoderType {
    static PSON = 1;
    static MSGPACK = 2;
}

export class EncoderHelper {
    packr: Packr;
    unpackr: Unpackr;
    constructor(private psonHelperEx: PsonHelperEx) {
        this.packr = new Packr({
            useRecords: false,
            variableMapSize: false,
            moreTypes: false,
            useTimestamp32: false,
            int64AsNumber: true,
            encodeUndefinedAsNil: true,
        });
        this.unpackr = new Unpackr({
            useRecords: false,
            variableMapSize: false,
            moreTypes: false,
            useTimestamp32: false,
            encodeUndefinedAsNil: true,
            int64AsNumber: true,
        });
    }
    
    getEncoder(encoderType: EncoderType) {
        if (encoderType === EncoderType.PSON) {
            return {
                encode: (value: unknown) => this.psonHelperEx.pson_encode(value),
                decode: <T>(bin: Buffer) => this.psonHelperEx.pson_decodeEx(bin) as T,
            };
        }
        
        if (encoderType === EncoderType.MSGPACK) {
            return {
                encode: (value: unknown) => this.packr.pack(value),
                decode: <T>(bin: Buffer) => {
                    return this.unpackr.unpack(bin) as T;
                },
            };
        }
        
        throw new Error("UNSUPPORTED ENCODER");
    }
}
