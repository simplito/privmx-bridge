/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as NodePath from "path";
import * as types from "../../types";
import * as fs from "fs";

export class VersionDetector {
    private static _version: types.core.Version|null;
    
    static get version(): types.core.Version|null {
        return this._version;
    }
    
    static detectBaseDir() {
        return NodePath.resolve(__dirname, "../../../");
    }
    
    static detectServerVersion() {
        if (!this._version) {
            const pkg = JSON.parse(fs.readFileSync(`${VersionDetector.detectBaseDir()}/package.json`, "utf8"));
            this._version = pkg.version as types.core.Version;
        }
        return this._version;
    }
}
