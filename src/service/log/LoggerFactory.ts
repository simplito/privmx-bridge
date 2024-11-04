/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */
/* eslint-disable max-classes-per-file */

import { Microseconds, MicroTimeUtils } from "../../utils/MicroTimeUtils";
import type * as Cluster from "cluster";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

function getWorkerId() {
    const mainId = cluster.isPrimary ? "MS" : cluster.worker.id.toString().padStart(2, "0");
    const pid = process.pid.toString().padStart(5, "0");
    return `${mainId},P:${pid}`;
}

export interface ILogFactory {
    createBuilder(): ILogBuilder;
}

export interface ILogBuilder {
    addLine(...args: unknown[]): void;
    flush(): void;
}

export class LoggerFactory {
    
    static ESCAPE_NEW_LINE = true;
    
    private defaultLevel: number;
    private levels: {[name: string]: number};
    private allowOut: boolean;
    
    constructor(
        private context: string,
        private appender: Appender,
    ) {
        this.defaultLevel = Logger.NOTICE;
        this.levels = {};
        this.allowOut = true;
    }
    
    get(value: any): Logger {
        const name = typeof(value) == "string" ? value : typeof(value) === "function" ? value.name : value.constructor.name;
        const level = name in this.levels ? this.levels[name] : this.defaultLevel;
        return new Logger(this.context, name, level, this.appender, this.allowOut);
    }
    
    getDefaultLevel() {
        return this.defaultLevel;
    }
    
    setDefaultLevel(defaultLevel: number) {
        this.defaultLevel = defaultLevel;
    }
    
    getLevel(loggerName: string) {
        return loggerName in this.levels ? this.levels[loggerName] : this.defaultLevel;
    }
    
    setLevel(loggerName: string, level: number) {
        this.levels[loggerName] = level;
    }
    
    getAllowOut() {
        return this.allowOut;
    }
    
    setAllowOut(allowOut: boolean) {
        this.allowOut = allowOut;
    }
    
    createBuilder(): ILogBuilder {
        return new LogBuilder(this.context, this.appender);
    }
    
    getAppender() {
        return this.appender;
    }
}

export class Logger {
    
    static readonly DEBUG = 1;
    static readonly INFO = 2;
    static readonly NOTICE = 3;
    static readonly WARNING = 4;
    static readonly ERROR = 5;
    
    constructor(
        private context: string,
        private name: string,
        private level: number,
        private appender: Appender,
        private allowOut: boolean,
    ) {
    }
    
    getLevel() {
        return this.level;
    }
    
    setLevel(level: number) {
        this.level = level;
    }
    
    isHandling(level: number): boolean {
        return level >= this.level;
    }
    
    protected log(prefix: string, ...args: unknown[]): void {
        const log = `${this.context}|[${new Date().toISOString()}][${getWorkerId()}]${prefix} ${args.map(x => serialize(x, false)).join(" ")}`;
        this.appender.log(LoggerFactory.ESCAPE_NEW_LINE ? log.replace(/\n/g, "\\n") : log);
    }
    
    protected logN(prefix: string, ...args: unknown[]): void {
        this.log(`[${this.name}]${prefix}`, ...args);
    }
    
    error(...args: unknown[]): void {
        if (this.isHandling(Logger.ERROR)) {
            this.logN("[ERROR]", ...args);
        }
    }
    
    warning(...args: unknown[]): void {
        if (this.isHandling(Logger.WARNING)) {
            this.logN("[WARNING]", ...args);
        }
    }
    
    notice(...args: unknown[]): void {
        if (this.isHandling(Logger.NOTICE)) {
            this.logN("[NOTICE]", ...args);
        }
    }
    
    info(...args: unknown[]): void {
        if (this.isHandling(Logger.INFO)) {
            this.logN("[INFO]", ...args);
        }
    }
    
    debug(...args: unknown[]): void {
        if (this.isHandling(Logger.DEBUG)) {
            this.logN("[DEBUG]", ...args);
        }
    }
    
    out(...args: unknown[]) {
        if (!this.allowOut) {
            return;
        }
        this.logN("", ...args);
    }
    
    private getElapsedTimeInMicro(startTime: [number, number]) {
        const endTime = process.hrtime();
        return ((endTime[0] - startTime[0]) * 1000000000 + (endTime[1] - startTime[1])) / 1000000;
    }
    
    stat(...args: unknown[]) {
        if (!this.allowOut) {
            return;
        }
        this.logN("[STAT]", ...args);
    }
    
    stats(startTime: [number, number], text: string) {
        const micro = this.getElapsedTimeInMicro(startTime);
        this.log(`[STATS] ${text};${micro}`);
        return micro;
    }
    
    stats2(text: string) {
        this.log(`[STATS] ${text}`);
    }
    
    update(text: string) {
        this.log(`[UPDATE] ${text}`);
    }
    
    time(startTime: [number, number], ...args: unknown[]) {
        if (this.isHandling(Logger.DEBUG)) {
            const endTime = process.hrtime();
            setImmediate(() => this.log(`[TIME] ${MicroTimeUtils.formatElapsedTimeInMili(startTime, endTime)}ms`, ...args));
        }
    }
    
    createLow(): LowLogger {
        return new LowLogger(this.context, this.level, this.appender);
    }
}

export interface Appender {
    log(...args: unknown[]): void;
}

export class ConsoleAppender implements Appender {
    
    log(...args: unknown[]): void {
        console.log(...args);
    }
}

export class EmptyAppender implements Appender {
    
    log(..._args: unknown[]): void {
        // Do nothing
    }
}

export class LowLogger {
    
    private startTime: Microseconds;
    private logs: {time: Microseconds, str: string}[];
    
    constructor(
        private context: string,
        private level: number,
        private appender: Appender
    ) {
        this.startTime = MicroTimeUtils.now();
        this.logs = [];
    }
    
    log(str: string): void {
        this.logs.push({time: MicroTimeUtils.now(), str: str});
    }
    
    flushLogInNextTick() {
        if (this.level > Logger.DEBUG) {
            return;
        }
        setTimeout(() => this.flushLog(), 1);
    }
    
    flushLog() {
        if (this.level > Logger.DEBUG) {
            return;
        }
        let last = this.startTime;
        for (const l of this.logs) {
            this.appender.log(`[${getWorkerId()}][${this.context}]${MicroTimeUtils.formatElapsedTimeInMili(last, l.time)}`, l.str);
            last = l.time;
        }
        this.appender.log(`[${getWorkerId()}][${this.context}]==============`);
    }
}

export class LogBuilder implements ILogBuilder {
    
    private lines: unknown[][] = [];
    
    constructor(
        private context: string,
        private appender: Appender,
    ) {
    }
    
    addLine(...args: unknown[]) {
        this.lines.push(args);
    }
    
    flush() {
        if (this.lines.length === 0) {
            return;
        }
        const res = `${this.context}|${this.lines.map(line => line.map(x => serialize(x, false)).join(" ")).join("\n")}`;
        this.appender.log(LoggerFactory.ESCAPE_NEW_LINE ? res.replace(/\n/g, "\\n") : res);
    }
}

function serialize(x: unknown, escapeString: boolean): string {
    if (typeof(x) === "object") {
        if (x === null) {
            return "null";
        }
        if (x instanceof Error) {
            let res = x.constructor.name + x.stack.slice(5);
            for (const k in x) {
                const value = (res as any)[k];
                if (typeof(value) != "undefined") {
                    res += `    ${k}: ${serialize(value, true)}\n`;
                }
            }
            return res;
        }
        if (Array.isArray(x)) {
            return `[${x.map(e => serialize(e, true)).join(", ")}]`;
        }
        return `{${Object.keys(x).map(k => `${k}: ${serialize((x as any)[k], true)}`).join(", ")}}`;
    }
    if (typeof(x) === "function") {
        return `function${x.name ? " " + x.name : ""}()`;
    }
    if (typeof(x) === "string") {
        return escapeString ? `"${x}"` : x;
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return "" + x;
}
