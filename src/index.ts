/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
import type * as Cluster from "cluster";
import type * as MasterModule from "./cluster/master/master";
import type * as WorkerModule from "./cluster/worker/worker";

const cluster = require("cluster") as Cluster.Cluster;

if (cluster.isPrimary) {
    const { startMaster } = require("./cluster/master/master") as typeof MasterModule;
    startMaster();
}
else {
    const {startWorker } = require("./cluster/worker/worker") as typeof WorkerModule;
    startWorker();
}
