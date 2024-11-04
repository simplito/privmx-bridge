/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import * as fs from "fs";
import * as path from "path";
import * as ChildProcess from "child_process";
import { API_ERROR_CODES } from "../../api/AppException";

async function go() {
    const toRemove: string[] = [];
    const omitFiles = ["src/docs/docs.json", "src/api/AppException.ts"];
    for (const errorCode in API_ERROR_CODES) {
        const stdout = await callGrep(errorCode);
        const occurencies = stdout.split("\n").filter(line => line && !omitFiles.includes(line.split(":")[0]));
        if (occurencies.length === 0) {
            toRemove.push(errorCode);
            console.log("To remove", errorCode);
        }
        // else {
        //     console.log("OK", errorCode);
        // }
    }
    const orgFilePath = path.resolve(__dirname, "../../../src/api/AppException.ts");
    const orgFileContent = fs.readFileSync(orgFilePath, "utf8");
    const newFileContent = orgFileContent.split("\n").filter(line => toRemove.every(x => !line.includes(x))).join("\n");
    fs.writeFileSync(orgFilePath, newFileContent, "utf8");
}

async function callGrep(pattern: string) {
    const dir = path.resolve(__dirname, "../../..");
    return new Promise<string>((resolve, reject) => {
        ChildProcess.exec(`cd ${dir} && grep -r "${pattern}" src`, (err, stdout) => {
            if (err) {
                reject(err);
            }
            resolve(stdout);
        });
    });
}

go().catch(e => console.log("Error", e));
