/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import { App } from "../../service/app/App";

async function exportData(configPath: string, dir: string) {
    const app = App.initWithConfigFile(configPath);
    try {
        app.ioc.takeMongoClientFromWorker = false;
        await app.initDb({});
        await app.ioc.workerRegistry.getWorkerCallbacks().trigger("initDb", []);
        await app.ioc.getImporter().export(dir);
        console.log("Finish");
    }
    finally {
        await app.ioc.getMongoDbManager().close();
        await app.ioc.workerRegistry.getWorkerCallbacks().trigger("closeDb", []);
    }
}

if (process.argv.length < 4) {
    console.log("Invalid arguments count. Usage: node export.js config-path dir");
    process.exit();
}

exportData(process.argv[2], process.argv[3]).catch(e => {
    console.log("Error during export", e);
});