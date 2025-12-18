/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { destination, LevelWithSilentOrString, LoggerOptions, pino, type Logger as PinoLogger } from "pino";
import { Logger } from "./Logger";

type TransportType = "file" | "pretty-console" | "json-console";
type SonicBoomType = ReturnType<typeof destination>
export class LoggerFactory {
    
    private readonly baseLoger: PinoLogger;
    private destination?: SonicBoomType;
    
    constructor(
        private context: string,
    ) {
        const [options, loggerDestination] = this.getDestinationParams(this.validateMode(process.env.PMX_BRIDGE_LOG_MODE) || "pretty-console", this.validateLevel(process.env.PMX_BRIDGE_LOG_LEVEL) || "info");
        this.destination = loggerDestination;
        this.baseLoger = pino(options, loggerDestination);
    }
    
    createLogger(value: any, host?: string): Logger {
        const name = typeof(value) == "string" ? value : typeof(value) === "function" ? value.name as string : value.constructor.name as string;
        return new Logger(this.context, host ? `${host}/${name}` : name, this.baseLoger);
    }
    
    flushLogs() {
        if (this.destination) {
            this.destination.flushSync();
        }
    }
    
    private getDestinationParams(type: TransportType, logLevel: LevelWithSilentOrString): [LoggerOptions, SonicBoomType | undefined] {
        switch (type) {
            case "file": {
                const options: LoggerOptions = {
                    level: logLevel,
                    transport: {
                        target: "pino/file",
                        options: {
                            destination: process.env.PMX_BRIDGE_LOG_LOCATION || "./privmx_bridge.logs",
                            mkdir: true,
                        },
                    },
                };
                return [options, undefined];
            }
            case "pretty-console": {
                const options = {
                    level: logLevel,
                    transport: {
                        target: "pino-pretty",
                        options: {
                            colorize: true,
                            translateTime: "SYS:dd-mm-yyyy HH:MM:ss",
                        },
                    },
                };
                return [options, undefined];
            }
            case "json-console": {
                const dest = destination(1);
                return [{ level: logLevel }, dest];
            }
            default:
                throw new Error("Unhandled transport type");
        }
    }
    
    private validateMode(mode: string|undefined): TransportType|undefined {
        if (mode && mode === "file" || mode === "pretty-console" || mode === "json-console") {
            return mode;
        }
        return undefined;
    }
    
    private validateLevel(mode: string|undefined): LevelWithSilentOrString|undefined {
        if (mode && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(mode)) {
            return mode as LevelWithSilentOrString;
        }
        return undefined;
    }
}