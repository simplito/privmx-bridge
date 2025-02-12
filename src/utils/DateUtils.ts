/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";
import { Uint64BE } from "int64-buffer";

export class DateUtils {
    
    static ZERO_TIME = <types.core.Timespan>0;
    static SECOND = <types.core.Timespan>1000;
    static MINUTE = <types.core.Timespan>(60 * DateUtils.SECOND);
    static HOUR = <types.core.Timespan>(60 * DateUtils.MINUTE);
    static DAY = <types.core.Timespan>(24 * DateUtils.HOUR);
    static WEEK = <types.core.Timespan>(7 * DateUtils.DAY);
    static MONTH = <types.core.Timespan>(30 * DateUtils.DAY);
    static EPOCH_N = <types.core.Timestamp>0;
    
    static add(a: types.core.Timestamp, b: types.core.Timespan): types.core.Timestamp;
    static add(a: types.core.Timespan, b: types.core.Timestamp): types.core.Timestamp;
    static add(a: types.core.Timespan, b: types.core.Timespan): types.core.Timespan;
    static add(a: number, b: number): number {
        return a + b;
    }
    
    static sub(a: types.core.Timestamp, b: types.core.Timestamp): types.core.Timespan;
    static sub(a: types.core.Timestamp, b: types.core.Timespan): types.core.Timestamp;
    static sub(a: types.core.Timespan, b: types.core.Timespan): types.core.Timespan;
    static sub(a: number, b: number): number {
        return a - b;
    }
    
    static mul(a: types.core.Timespan, b: number): types.core.Timespan;
    static mul(a: number, b: number): number {
        return a * b;
    }
    
    static miliseconds(milliseconds: number): types.core.Timespan {
        return <types.core.Timespan>milliseconds;
    }
    
    static seconds(seconds: number): types.core.Timespan {
        return <types.core.Timespan>(seconds * DateUtils.SECOND);
    }
    
    static minutes(minutes: number): types.core.Timespan {
        return <types.core.Timespan>(minutes * DateUtils.MINUTE);
    }
    
    static hours(hours: number): types.core.Timespan {
        return <types.core.Timespan>(hours * DateUtils.HOUR);
    }
    
    static days(days: number): types.core.Timespan {
        return <types.core.Timespan>(days * DateUtils.DAY);
    }
    
    static nowAdd(time: types.core.Timespan): types.core.Timestamp {
        return <types.core.Timestamp>(Date.now() + time);
    }
    
    static nowSub(time: types.core.Timespan): types.core.Timestamp {
        return <types.core.Timestamp>(Date.now() - time);
    }
    
    static now(): types.core.Timestamp {
        return <types.core.Timestamp>Date.now();
    }
    
    static today(): types.core.Timestamp {
        return <types.core.Timestamp>(Math.floor(Date.now() / DateUtils.DAY) * DateUtils.DAY);
    }
    
    static getDaysBetween(a: types.core.Timestamp, b: types.core.Timestamp): number {
        return Math.floor((b - a) / DateUtils.DAY);
    }
    
    static convertStrToTimestamp(timestamp: types.core.TimestampStr): types.core.Timestamp {
        return <types.core.Timestamp>parseInt(timestamp, 10);
    }
    
    static getDayTimestamp(timestamp: types.core.Timestamp): types.core.Timestamp {
        const date = new Date(timestamp);
        return <types.core.Timestamp>Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    
    static getWeekTimestamp(timestamp: types.core.Timestamp): types.core.Timestamp {
        const date = new Date(DateUtils.getDayTimestamp(timestamp));
        return <types.core.Timestamp>(date.getTime() - date.getDay() * DateUtils.DAY);
    }
    
    static getMonthTimestamp(timestamp: types.core.Timestamp): types.core.Timestamp {
        const date = new Date(timestamp);
        return <types.core.Timestamp>Date.UTC(date.getUTCFullYear(), date.getUTCMonth());
    }
    
    static timeElapsed(start: types.core.Timestamp, timeToElapsed: types.core.Timespan, now?: types.core.Timestamp): boolean {
        const n = now == null ? Date.now() : now;
        const s = start;
        return n - s > timeToElapsed;
    }
    
    static timestampInRange(timestamp: types.core.Timestamp, diff: types.core.Timespan, now?: types.core.Timestamp): boolean {
        const n = now == null ? Date.now() : now;
        const t = timestamp;
        return t >= n - diff && t <= n + diff;
    }
    
    static addDay(timestamp: types.core.Timestamp): types.core.Timestamp {
        return DateUtils.add(timestamp, DateUtils.DAY);
    }
    
    static addWeek(timestamp: types.core.Timestamp): types.core.Timestamp {
        return DateUtils.add(timestamp, DateUtils.WEEK);
    }
    
    static addMonth(timestamp: types.core.Timestamp): types.core.Timestamp {
        const date = new Date(timestamp);
        date.setUTCMonth(date.getUTCMonth() + 1);
        return <types.core.Timestamp>date.getTime();
    }
    
    static getCurrentMonthFirstDayStart() {
        const now = new Date();
        return <types.core.Timestamp>Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    }
    
    static getCurrentMonthLastDayEnd() {
        const now = new Date();
        return <types.core.Timestamp>Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, -1);
    }
    
    // =========================
    
    static getTimestampAs64BEBuffer(): Buffer {
        return new Uint64BE(DateUtils.now()).toBuffer();
    }
    
    static getTimestampFrom64BEBuffer(buffer: Buffer): types.core.Timestamp {
        return <types.core.Timestamp> new Uint64BE(buffer.slice(0, 8)).toNumber();
    }
    
    static getUtcDateStr(date: Date): string {
        return date.getUTCFullYear() +
            (date.getUTCMonth() + 1).toString().padStart(2, "0") +
            (date.getUTCDate()).toString().padStart(2, "0") +
            (date.getUTCHours()).toString().padStart(2, "0") +
            (date.getUTCMinutes()).toString().padStart(2, "0") +
            (date.getUTCSeconds()).toString().padStart(2, "0");
    }
}
