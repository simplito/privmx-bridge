/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../../service/log/LoggerFactory";
import { IpcRequest, IpcResponseError, IpcResponseSuccess } from "./Ipc";
import { MethodExecutor } from "./MethodExecutor";

export class IpcExecutor {
    
    constructor(
        private methodExecutor: MethodExecutor,
        private logger: Logger,
    ) {
    }
    
    async execute(data: IpcRequest) {
        try {
            const result = await this.methodExecutor.execute(data.method, data.params);
            const response: IpcResponseSuccess = {id: data.id, result: typeof(result) === "undefined" ? null : result};
            return response;
        }
        catch (e) {
            this.logger.error("Error during processing request", data.id, data.method, e);
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            const response: IpcResponseError = {id: data.id, error: "" + e};
            return response;
        }
    }
}
