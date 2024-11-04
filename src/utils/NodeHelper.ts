/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as exec from "child_process";
import { Logger } from "../service/log/LoggerFactory";

export interface ExecResult {
    type: "exec";
    error: Error;
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class NodeHelper {
    
    constructor(
        private logger: Logger,
    ) {
    }
    
    executeCommandEx(command: string, args: string[]): Promise<string> {
        return this.executeCommand(command + " " + args.join(" "), "");
    }
    
    executeCommand(command: string, stdin: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let exitCode: number;
            const proc = exec
                .exec(command, {encoding: "utf8"}, (error, stdout, stderr) => {
                    if (error) {
                        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                        return reject(<ExecResult>{type: "exec", error: error, stdout: stdout, stderr: stderr, exitCode: exitCode});
                    }
                    resolve(stdout);
                })
                .on("error", e => {
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    reject(<ExecResult>{type: "exec", error: e, stdout: "<Error-during-spawning>", stderr: "<Error-during-spawning>", exitCode: -1});
                })
                .on("exit", code => {
                    exitCode = code;
                });
            proc.stdin.on("error", e => this.logger.error("Error stdin during spawning process", e));
            proc.stdout.on("error", e => this.logger.error("Error stdout during spawning process", e));
            proc.stderr.on("error", e => this.logger.error("Error stderr during spawning process", e));
            if (stdin) {
                proc.stdin.write(stdin);
                proc.stdin.end();
            }
        });
    }
}
