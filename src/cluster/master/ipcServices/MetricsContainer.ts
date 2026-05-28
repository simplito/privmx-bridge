/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../Decorators";
import * as types from "../../../types";
import { ApiMethod } from "../../../api/Decorators";
import { DateUtils } from "../../../utils/DateUtils";
import { MetricsCollector } from "../../../service/misc/MetricsCollector";

interface Metrics {
    solutionId: types.cloud.SolutionId;
    contextId: types.context.ContextId;
    requests: types.core.Quantity;
    errors: types.core.Quantity;
    executionTime: types.core.Timespan;
    inTraffic: types.core.SizeInBytes;
    outTraffic: types.core.SizeInBytes;
}

@IpcService
export class MetricsContainer {
    
    private metrics: Map<string, Metrics> = new Map();
    private flushTimeoutHandle: NodeJS.Timeout;
    private defaultNodeMetrics: Map<string, string> = new Map();
    
    constructor(
        private metricsCollector: MetricsCollector,
    ) {
        this.flushTimeoutHandle = setTimeout(() => {
            void this.flush();
        }, DateUtils.minutes(1));
    }
    
    @ApiMethod({})
    async addMetrics(model: Metrics) {
        const key = model.solutionId + model.contextId;
        const entry = this.metrics.get(key);
        if (!entry) {
            this.metrics.set(key, model);
        }
        else {
            entry.errors = entry.errors + model.errors as types.core.Quantity;
            entry.executionTime = entry.executionTime + model.executionTime as types.core.Timespan;
            entry.inTraffic = entry.inTraffic + model.inTraffic as types.core.SizeInBytes;
            entry.outTraffic = entry.outTraffic + model.outTraffic as types.core.SizeInBytes;
            entry.requests = entry.requests + model.requests as types.core.Quantity;
        }
    }
    
    @ApiMethod({})
    async sendDefaultMetrics(model: {workerId: string, workerMetrics: string}) {
        this.defaultNodeMetrics.set(model.workerId, model.workerMetrics);
    }
    
    @ApiMethod({})
    async getMetrics() {
        const metrics: string[] = [
            "# TYPE privmx_bridge_error_gauge gauge",
            "# TYPE privmx_bridge_cpu_execution_time_gauge gauge",
            "# TYPE privmx_bridge_in_traffic_gauge gauge",
            "# TYPE privmx_bridge_out_traffic_gauge gauge",
            "# TYPE privmx_bridge_request_gauge gauge",
        ];
        for (const entry of this.metrics.values()) {
            const metricLabel = `{solutionId="${entry.solutionId}",contextId="${entry.contextId}"}`;
            metrics.push(`privmx_bridge_error_gauge${metricLabel} ${entry.errors}`);
            metrics.push(`privmx_bridge_cpu_execution_time_gauge${metricLabel} ${entry.executionTime}`);
            metrics.push(`privmx_bridge_in_traffic_gauge${metricLabel} ${entry.inTraffic}`);
            metrics.push(`privmx_bridge_out_traffic_gauge${metricLabel} ${entry.outTraffic}`);
            metrics.push(`privmx_bridge_request_gauge${metricLabel} ${entry.requests}`);
        }
        metrics.push((await this.metricsCollector.getThisWorkerMetrics()).workerMetrics);
        metrics.push(...Array.from(this.defaultNodeMetrics.values()));
        void this.flush();
        return metrics.join("\n");
    }
    
    async flush() {
        clearTimeout(this.flushTimeoutHandle);
        this.flushTimeoutHandle = setTimeout(() => {
            void this.flush();
        }, DateUtils.minutes(1));
        this.metrics.clear();
    }
}
