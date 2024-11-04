/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */

import { ApiMethod } from "../../api/Decorators";
import { DateUtils } from "../../utils/DateUtils";
import { IpRateLimiter } from "../common/IpRateLimiter";
import * as types from "../../types";
import { Config } from "../common/ConfigUtils";

export class IpMapEntry {
    
    private lastActivity: types.core.Timestamp;
    
    constructor(
        private credits: number,
        private maxCredit: number,
    ) {
        this.lastActivity = DateUtils.now();
    }

    payIfPossible(cost: number) {
        if (cost > this.credits) {
            return false;
        }
        this.credits = <number>(this.credits - cost);
        this.lastActivity = DateUtils.now();
        return true;
    }
    
    addCredits(credits: number) {
        this.credits = <number>Math.min(this.credits + credits, this.maxCredit);
    }
    
    getCredits() {
        return this.credits;
    }
    
    getLastActivityTime() {
        return this.lastActivity;
    }
}

export class IpRateLimiterImpl implements IpRateLimiter {

    private ipMap: Map<types.core.IPAddress, IpMapEntry>;

    constructor(
        private config: Config,
    ) {
        this.ipMap = new Map();
    }

    @ApiMethod({})
    async canPerformRequest(ip: types.core.IPAddress): Promise<boolean> {
        return this.canPerformRequestWithCost(ip, this.config.apiRateLimit.requestCost);
    }

    private get whitelist() {
        return this.config.apiRateLimit.whitelist;
    }

    private canPerformRequestWithCost(ip: types.core.IPAddress, cost: number): boolean {
        if (!this.config.apiRateLimit.enabled) {
            return true;
        }
        if (this.whitelist.includes(ip)) {
            return true;
        }
        const entry = this.getEntry(ip);
        const paymentPerformed = entry.payIfPossible(cost);
        return paymentPerformed;
    }

    async addCreditsAndRemoveInactive(): Promise<void> {
        const inactive: types.core.IPAddress[] = [];
        for (const [ip, ipEntry] of this.ipMap.entries()) {
            if (this.isEntryInactive(ipEntry)) {
                inactive.push(ip);
            }
            else {
                ipEntry.addCredits(this.config.apiRateLimit.creditAddon);
            }
        }
        for (const ip of inactive) {
            this.ipMap.delete(ip);
        }
    }
    
    private isEntryInactive(ipEntry: IpMapEntry) {
        return ipEntry.getCredits() >= this.config.apiRateLimit.maxCredit && (ipEntry.getLastActivityTime() + this.config.apiRateLimit.inactiveTime) < DateUtils.now();

    }
    
    private getEntry(ip: types.core.IPAddress) {
        if (!this.ipMap.has(ip)) {
            const cfg = this.config.apiRateLimit;
            this.ipMap.set(ip, new IpMapEntry(cfg.initialCredit, cfg.maxCredit));
        }
        return <IpMapEntry> this.ipMap.get(ip);
    }
}
