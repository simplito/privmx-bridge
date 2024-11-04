/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type Microseconds = [number, number];
export type MicrosecondsBI = bigint;

export class MicroTimeUtils {
    
    static now(): Microseconds {
        return process.hrtime();
    }
    
    static nowBI(): MicrosecondsBI {
        return process.hrtime.bigint();
    }
    
    static getElapsedTimeInMiliBI(startTime: MicrosecondsBI, endTime?: MicrosecondsBI) {
        const theEndTime = typeof(endTime) === "undefined" ? MicroTimeUtils.nowBI() : endTime;
        return Number((theEndTime - startTime) / 1000n) / 1000;
    }
    
    static getElapsedTimeInMili(startTime: Microseconds, endTime?: Microseconds) {
        const theEndTime = typeof(endTime) === "undefined" ? MicroTimeUtils.now() : endTime;
        const seconds = theEndTime[0] - startTime[0];
        const nano = theEndTime[1] - startTime[1];
        return (seconds * 1000000000 + nano) / 1000000;
    }
    
    static formatMili(mili: number) {
        const str = mili.toString().split(".");
        return str[0].padStart(2, " ") + "." + (str[1] || "").substring(0, 4).padEnd(4, " ");
    }
    
    static formatElapsedTimeInMili(startTime: Microseconds, endTime?: Microseconds) {
        return MicroTimeUtils.formatMili(MicroTimeUtils.getElapsedTimeInMili(startTime, endTime));
    }
}
