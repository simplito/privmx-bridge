/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { RequestScopeIOC } from "../service/ioc/RequestScopeIOC";
import { MethodInfo } from "../service/log/RequestLogger";

export class RequestContext {
    
    constructor(
        public ioc: RequestScopeIOC,
    ) {
    }
    
    runWith<T>(func: (methodInfo: MethodInfo) => Promise<T>) {
        return this.ioc.requestLogger.runWith(func);
    }
    
    setLogging(logging: boolean) {
        this.ioc.requestLogger.setLogging(logging);
    }
    
    setMainException(e: any) {
        this.ioc.requestLogger.setMainException(e);
    }
    
    flush() {
        this.ioc.requestLogger.flush();
    }
}