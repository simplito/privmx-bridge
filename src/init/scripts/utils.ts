/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as exec from "child_process";
import * as path from "path";
import { InitConfigValues } from "../../service/config/ConfigLoader";

export function getDomainDir(domain: string) {
    return path.resolve(__dirname, "../../../conf/" + domain);
}

export function getDbName(domain: string) {
    return "privmx_" + domain.replace(/\./g, "_");
}

export function executeCommand(command: string, stdin: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const proc = exec.exec(command, {encoding: "utf8"}, (error, stdout, stderr) => {
            if (error) {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                return reject({error: error, stdout: stdout, stderr: stderr});
            }
            resolve(stdout);
        });
        proc.stdin?.write(stdin);
        proc.stdin?.end();
    });
}

export interface ConfigVars {
    domain: string;
    port: number;
    secure: boolean;
    instanceName: string;
    mongoUrl: string;
    mongoDb: string;
}

export interface CreateContext {
    config: InitConfigValues;
    domain: string;
    dbName: string;
    port: number;
    instanceName: string;
    outDir: string;
    configPath: string;
}

export interface CreateServerOptions {
    modifyConfig?: (context: CreateContext) => unknown;
    onAfter?: (context: CreateContext) => unknown;
}

export function getScriptName() {
    return path.basename(process.argv[1]);
}

export interface RemoveContext {
    domain: string;
    dbName: string;
    outDir: string;
}

export interface RemoveServerOptions {
    onAfter?: (context: RemoveContext) => unknown;
}

export async function removeServer(domain: string, options?: RemoveServerOptions) {
    const outDir = getDomainDir(domain);
    await executeCommand("rm -rf " + outDir, "");
    
    const dbName = getDbName(domain);
    await executeCommand("mongo --eval \"db.dropDatabase()\" " + dbName, "");
    if (options && typeof(options.onAfter) == "function") {
        await options.onAfter({domain: domain, dbName: dbName, outDir: outDir});
    }
}

export async function removeServerFromArgv(options?: RemoveServerOptions) {
    if (process.argv.length < 3) {
        // eslint-disable-next-line no-console
        console.log("Invalid arguments\nUsage: node " + getScriptName() + " my.domain.com");
        process.exit(1);
    }
    const domain = process.argv[2];
    await removeServer(domain, options);
}

export async function cleanDbByDomain(options?: {onAfter: (context: {domain: string; dbName: string;}) => unknown}) {
    if (process.argv.length < 3) {
        // eslint-disable-next-line no-console
        console.log("Invalid arguments\nUsage: node " + getScriptName() + " my.domain.com");
        process.exit();
    }
    const domain = process.argv[2];
    const dbName = getDbName(domain);
    await cleanDb({domain: domain, dbName: dbName}, options);
}

export async function cleanDbByDbName(options?: {onAfter: (context: {dbName: string;}) => unknown}) {
    if (process.argv.length <= 2) {
        // eslint-disable-next-line no-console
        console.log("Usage: node " + getScriptName() + " {db_name}\nExample: node " + getScriptName() + " privmx_lukas19");
        process.exit();
    }
    const dbName = process.argv[2];
    await cleanDb({dbName: dbName}, options);
}

export async function cleanDb<C extends {dbName: string}>(context: C, options?: {onAfter: (context: C) => unknown}) {
    await executeCommand('mongo --eval "db.dropDatabase()" ' + context.dbName, "");
    if (options && typeof(options.onAfter) == "function") {
        await options.onAfter(context);
    }
}
