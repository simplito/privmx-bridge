/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { type Logger as PinoLogger } from "pino";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";

export class Logger {
    
    static readonly TRACE = 10;
    static readonly DEBUG = 20;
    static readonly INFO = 30;
    static readonly WARN = 40;
    static readonly ERROR = 50;
    static readonly FATAL = 60;
    
    private readonly logger: PinoLogger;
    
    constructor(
        private context: string,
        private name: string,
        baseLogger: PinoLogger,
    ) {
        this.logger = baseLogger.child({ name: `${this.context}/${this.name}`, level: baseLogger.level });
    }
    
    get level() {
        return this.logger.levelVal;
    }
    
    isLoggingOnThisLevel(logLevel: number) {
        return this.level <= logLevel;
    }
    
    out(...args: Parameters<PinoLogger["info"]>) {
        this.logger.info(...args);
    }
    
    warning(...args: Parameters<PinoLogger["warn"]>) {
        this.logger.warn(...args);
    }
    
    error(...args: Parameters<PinoLogger["error"]>) {
        this.logger.error(...args);
    }
    
    debug(...args: Parameters<PinoLogger["debug"]>) {
        this.logger.debug(...args);
    }
    
    time(startTime: [number, number], msg: string, ...args: unknown[]) {
        if (this.isLoggingOnThisLevel(Logger.DEBUG)) {
            const diff = process.hrtime();
            this.logger.debug({durationMs: MicroTimeUtils.formatElapsedTimeInMili(startTime, diff), args}, msg);
        }
    }
}

