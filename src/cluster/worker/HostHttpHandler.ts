/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import { PrivmxExpressApp } from "../../service/app/PrivmxExpressApp";

export class HostHttpHandler {
    
    constructor(
        private privmxExpressApp: PrivmxExpressApp,
    ) {
    }
    
    onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        this.privmxExpressApp.expressApp(req, res);
    }
}
