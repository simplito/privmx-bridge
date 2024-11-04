/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import { Logger } from "../../service/log/LoggerFactory";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;
export class WorkersHolder {
    
    private workers: Cluster.Worker[] = [];
    
    constructor(
        private logger: Logger,
    ) {
        cluster.on("exit", (worker, code, signal) => {
            this.logger.out(`Worker died W:${worker.id},P:${worker.process.pid} died {code: ${code}, signal: ${signal}}`);
            this.workers = this.workers.filter(x => x.id !== worker.id);
        });
    }
    
    createWorker() {
        const worker = cluster.fork();
        this.workers.push(worker);
        return worker;
    }
    
    getWorkers() {
        return this.workers;
    }
    
    hasWorkers() {
        return this.workers.length > 0;
    }
    
    killWorkers() {
        for (const worker of this.workers) {
            worker.kill("SIGINT");
        }
    }
}
