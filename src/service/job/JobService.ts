/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../log/LoggerFactory";

export interface JobEntry {
    intervalId: NodeJS.Timeout;
    func: () => unknown;
    intervalPeriod: number;
}

export class JobService {
    
    private jobs: {[name: string]: JobEntry} = {};
    
    constructor(
        private logger: Logger,
    ) {}
    
    addPeriodicJob(func: () => unknown, interval: number, name: string) {
        const newJobEntry = {
            func: func,
            intervalPeriod: interval,
            intervalId: setInterval(func, interval),
        };
        this.jobs[name] = newJobEntry;
    }
    
    clearJob(name: string) {
        if (!this.jobs[name]) {
            throw new Error("Job not set");
        }
        clearInterval(this.jobs[name].intervalId);
        delete this.jobs[name];
    }
    
    clearAllJobs() {
        for (const name in this.jobs) {
            clearInterval(this.jobs[name].intervalId);
        }
        this.jobs = {};
    }
    
    addJob(job: Promise<unknown>|(() => unknown), errorMessage: string): void {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
            try {
                if (typeof(job) == "function") {
                    await job();
                }
                else {
                    await job;
                }
            }
            catch (e) {
                this.logger.error(errorMessage || "Error in job", e);
            }
        })();
    }
}
