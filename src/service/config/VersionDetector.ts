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
    
    static detectBaseDir() {
        return NodePath.resolve(__dirname, "../../../");
    }
    
    static detectServerVersion() {
        const serverVersionFile = NodePath.resolve(this.detectBaseDir(), "version");
        return <types.core.Version>(fs.existsSync(serverVersionFile) ? fs.readFileSync(serverVersionFile, "utf8").trim() : "1.0.0-dev");
    }
}