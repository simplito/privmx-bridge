/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PromiseUtils } from "./PromiseUtils";
import * as fs from "fs";

export class FsPromise {
    
    static readdir(dir: fs.PathLike) {
        return PromiseUtils.callbackToPromise<string[]>(x => fs.readdir(dir, x));
    }
    
    static stat(file: fs.PathLike) {
        return PromiseUtils.callbackToPromise<fs.Stats>(x => fs.stat(file, x));
    }
    
    static exists(file: fs.PathLike) {
        return PromiseUtils.callbackToPromise2<boolean>(x => fs.exists(file, x));
    }
    
    static readFile(file: fs.PathLike) {
        return PromiseUtils.callbackToPromise<Buffer>(x => fs.readFile(file, x));
    }
    
    static readFileEnc(file: fs.PathLike, enc: BufferEncoding) {
        return PromiseUtils.callbackToPromise<string>(x => fs.readFile(file, enc, x));
    }
    
    static writeFile(file: fs.PathLike, data: Buffer) {
        return PromiseUtils.callbackToPromiseVoid(x => fs.writeFile(file, data, x));
    }
    
    static writeFileEnc(file: fs.PathLike, data: string, enc: BufferEncoding) {
        return PromiseUtils.callbackToPromiseVoid(x => fs.writeFile(file, data, enc, x));
    }
}