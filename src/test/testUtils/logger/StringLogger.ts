/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../../../service/log/LoggerFactory";

export class StringLogger extends Logger {
    
    logs: {level: string, text: string, data?: any, data2?: any}[] = [];
    
    constructor() {
        super("test", "fake", Logger.DEBUG, null, true);
    }
    
    log(level: string, text: string, data?: any, data2?: any): void {
        this.logs.push({level, text, data, data2});
    }
}
