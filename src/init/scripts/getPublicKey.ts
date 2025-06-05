/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import type * as Cluster from "cluster";
import { loadConfig } from "../../cluster/common/ConfigUtils";
import { ConsoleAppender, LoggerFactory } from "../../service/log/LoggerFactory";
import * as util from "util";
import { WorkerRegistry } from "../../cluster/worker/WorkerRegistry";
import { Base58 } from "../../utils/crypto/Base58";

const loggerFactory = new LoggerFactory("MAIN", new ConsoleAppender());

async function go() {
    const args = process.argv;
    console.log("NOTICE: Fetching key requires connection with database!");
    const registry = new WorkerRegistry(loggerFactory);
    const worker = {on: (_ev: string, message: any) => console.log(message), send: (workerArgs: any) => console.log(workerArgs)} as unknown as Cluster.Worker;
    registry.registerWorker(worker);
    const config = registry.registerConfig(loadConfig(false, registry.getWorkerCallbacks()));
    if (config.server.mode.type !== "single") {
        throw new Error("Only single mode is supported");
    }
    registry.registerIpcService("activeUsersMap", {});
    registry.registerIpcService("metricsContainer", {});
    LoggerFactory.ESCAPE_NEW_LINE = config.loggerEscapeNewLine;
    try {
        await registry.createMongoClient(config.db.mongo.url);
        const ioc = await registry.getHttpHandler().createHostContext();
        const pkiFactory = ioc.getPkiFactory();
        const keystore = await pkiFactory.loadKeystore();
        const serverPublicKeyPem = keystore.getPrimaryKey().keyPair.getPublicView().serializeWithArmor();
        const der58PublicKey = readPubKeyFromPem(serverPublicKeyPem);
        if (args.length === 3 && args[2] == "--kvprint") {
            keyValuePrint(der58PublicKey);
        }
        else {
            prettyPrintKey(der58PublicKey);
        }
    }
    catch {
        console.log("[ERROR] An error occurred. Please try retrieving the key again.");
    }
    finally {
        await registry.getMongoClient().close();
    }
}

function consoleErr(str: string) {
    process.stderr.write(str + "\n");
}

function readPubKeyFromPem(pem: string) {
    const base64 = pem.split("\n")
        .filter(x => x && !x.startsWith("---") && !x.startsWith("="))
        .join("");
    const buffer = Buffer.from(base64, "base64");
    const der = buffer.subarray(16, 81);
    return Base58.encode(der);
}

function keyValuePrint(keyValue: string) {
    console.log(`PUBLIC_KEY=${keyValue}`);
}

function prettyPrintKey(
    keyValue: string,
    title: string = "SERVER PUBLIC KEY",
    maxWidth: number = 94,
    keyColor: string = "\x1b[33m",
    borderColor: string = "\x1b[36m",
    titleColor: string = "\x1b[1m\x1b[37m",
  ) {
    const resetColor = "\x1b[0m";
    const keyStr = keyValue.toString();
    const contentWidth = Math.min(maxWidth, process.stdout.columns);
    const boxWidth = contentWidth;
    const topBorder = `${borderColor}╔${"═".repeat(boxWidth - 2)}╗${resetColor}`;
    const padding = Math.floor((boxWidth - title.length - 2) / 2);
    const extraSpace = boxWidth - title.length - padding - 2;
    const header = `${borderColor}║${resetColor}${" ".repeat(padding)}${titleColor}${title}${resetColor}${" ".repeat(extraSpace)}${borderColor}║${resetColor}`;
    const separator = `${borderColor}╚${"═".repeat(boxWidth - 2)}╝${resetColor}`;
    const contentPadding = boxWidth - keyStr.length - 3;
    const keyContent = `${resetColor} ${keyColor}${keyStr}${resetColor}${" ".repeat(Math.max(0, contentPadding))}${resetColor}`;
    console.log("\n" + topBorder);
    console.log(header);
    console.log(separator);
    console.log(keyContent + "\n");
}

go().catch(e => {
    consoleErr("Error:" + util.format(e));
    process.exit(1);
});
