/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../log/LoggerFactory";

export interface JobOptions {
    name: string;
    func: () => any;
    interval: number;
    runOnCreate: boolean;
}

export interface JobEntry {
    intervalId: NodeJS.Timeout;
    options: JobOptions;
}

export type OneShotJobId = number&{__oneShotJobId: never};

export interface OneShotJob {
    readonly done: boolean;
    cancel(): void;
    reschedule(timeout: number): void;
}

export interface OneShotJobObj extends OneShotJob {
    id: OneShotJobId;
    jobType: string;
    originalFunc: () => any;
    func: () => Promise<void>;
    created: number;
    timeout: number;
    timeoutId: NodeJS.Timeout;
    done: boolean;
}

export class JobManager {
    
    private jobs: Map<string, JobEntry>;
    private oneShotsId: number;
    private oneShots: Map<OneShotJobId, OneShotJobObj>;
    
    constructor(
        private logger: Logger,
    ) {
        this.jobs = new Map();
        this.oneShotsId = 0;
        this.oneShots = new Map();
    }
    
    stopAll() {
        for (const job of this.jobs.values()) {
            clearInterval(job.intervalId);
        }
        this.jobs.clear();
        for (const job of this.oneShots.values()) {
            this.logger.warning("One shot job '" + job.jobType + "' (id=" + job.id + ") cancelled");
            clearTimeout(job.timeoutId);
            job.done = true;
        }
        this.oneShots.clear();
    }
    
    createOneShot(jobType: string, func: () => any, timeout: number): OneShotJob {
        const id = <OneShotJobId>(this.oneShotsId++);
        const job: OneShotJobObj = {
            id: id,
            done: false,
            jobType: jobType,
            originalFunc: func,
            func: async ()  => {
                try {
                    await func();
                }
                catch (e) {
                    this.logger.error("Error during running one shot job '" + jobType + "' " + id, e);
                }
                finally {
                    job.done = true;
                    this.oneShots.delete(id);
                }
            },
            created: Date.now(),
            timeout: timeout,
            timeoutId: setTimeout(() => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                job.func();
            }, timeout),
            cancel: () => {
                if (job.done) {
                    return;
                }
                clearTimeout(job.timeoutId);
                job.done = true;
                this.oneShots.delete(id);
            },
            reschedule: newTimeout => {
                if (job.done) {
                    throw new Error("Job is already done");
                }
                clearTimeout(job.timeoutId);
                job.timeoutId = setTimeout(() => {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    job.func();
                }, newTimeout);
                job.timeout = newTimeout;
            }
        };
        this.oneShots.set(id, job);
        return job;
    }
    
    createJob(options: JobOptions) {
        if (options.name in this.jobs) {
            throw new Error("Job with name '" + options.name + "' already exists");
        }
        this.jobs.set(options.name, {
            options: options,
            intervalId: setInterval(() => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.run(options);
            }, options.interval)
        });
        if (options.runOnCreate) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.run(options);
        }
    }
    
    async run(options: Pick<JobOptions, "name"|"func">) {
        try {
            this.logger.info("Job '" + options.name + "' started");
            await options.func();
        }
        catch (e) {
            this.logger.error("Error during running job '" + options.name + "'", e);
        }
    }
}