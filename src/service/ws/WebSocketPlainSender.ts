/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { IWorker2Service } from "../../cluster/common/Worker2Service";
import { JobService } from "../job/JobService";
import { PlainApiEvent } from "../../api/plain/Types";

export class WebSocketPlainSender {
    
    constructor(
        private workerService: IWorker2Service,
        private jobService: JobService,
    ) {
    }

    sendToPlainUsers(solution: types.cloud.SolutionId, event: PlainApiEvent) {
        this.jobService.addJob(async () => {
            await this.workerService.sendWebsocketNotificationToPlainUsers({solution, event});
        }, "Error during sending websocket notification to plain users");
    }
}
