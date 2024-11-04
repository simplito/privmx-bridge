/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import { loadConfig } from "../../cluster/common/ConfigUtils";

async function go() {
    const config = loadConfig(false);
    if (config.server.mode.type !== "single") {
        throw new Error("Only single mode is supported");
    }
    const url = `http://localhost:${config.server.port}/health`;
    console.log(`Trying localhost ${url}...`);
    const response = await fetch(url);
    const result = await response.text();
    console.log("Get", response.status, result);
    const isOk = response.status == 200 && result === '{"status":"ok"}';
    console.log(isOk ? "Healthy" : "Unhealthy");
    process.exit(isOk ? 0 : 1);
}

go().catch(e => {
    console.log("Error", e);
    console.log("Unhealthy");
    process.exit(1);
});