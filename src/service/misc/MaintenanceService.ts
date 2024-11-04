/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as path from "path";
import * as fs from "fs";

export class MaintenanceService {
    
    getMaintenanceLockPath() {
        return path.resolve(__dirname + "/../../../maintenance.lock");
    }
    
    isMaintenanceModeEnabled() {
        const lockPath = this.getMaintenanceLockPath();
        return fs.existsSync(lockPath);
    }
    
    enterMaintenanceMode() {
        const lockPath = this.getMaintenanceLockPath();
        if (!fs.existsSync(lockPath)) {
            fs.writeFileSync(lockPath, "1");
        }
        return true;
    }
    
    exitMaintenanceMode() {
        const lockPath = this.getMaintenanceLockPath();
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
        return true;
    }
}