/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as promClient from "prom-client";
import { Utils } from "../../utils/Utils";

export class MetricsCollector {
    
    private prometheusMetricsRegistry: promClient.Registry;
    private workerId: string;
    
    constructor() {
        this.workerId = Utils.getThisWorkerId();
        this.prometheusMetricsRegistry = new promClient.Registry();
        this.prometheusMetricsRegistry.setDefaultLabels({
            worker: this.workerId,
        });
        promClient.collectDefaultMetrics({register: this.prometheusMetricsRegistry});
    }
    
    async getThisWorkerMetrics() {
        return {workerId: this.workerId, workerMetrics: await this.prometheusMetricsRegistry.metrics()};
    }
}