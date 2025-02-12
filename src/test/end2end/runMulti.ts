/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */
import { TestMethod, TestScanner, TestSet, TestSummary } from "./BaseTestSet";
import * as Cluster from "cluster";
import { DateUtils } from "../../utils/DateUtils";
import * as os from "os";

/* eslint-disable-next-line */
const cluster = require("cluster") as Cluster.Cluster;

async function runTestsInParallel(testSets: TestSet[]) {
    const testResults: TestSummary[] = [];
    const tasks: { testSet: TestSet; test: TestMethod }[] = [];
    let taskIndex = 0;
    
    testSets.forEach(testSet => {
        testSet.tests.forEach(test => {
            tasks.push({ testSet, test });
        });
    });
    
    return new Promise<number>((resolve) => {
        const processIdleWorker = (worker: Cluster.Worker) => {
            const task = tasks[taskIndex++];
            if (!task) {
                worker.kill("SIGINT");
                return;
            }
            worker.send({
                testSetName: task.testSet.testConstructor.name,
                test: JSON.stringify(task.test),
            });
        };
        
        const handleWorkerMessage = (worker: Cluster.Worker, message: TestSummary) => {
            testResults.push(message);
            processIdleWorker(worker);
            
            if (tasks.length === testResults.length) {
                resolve(testResults.filter(result => !result.testStatus).length);
            }
        };
        
        const numCPUs = os.cpus().length;
        for (let i = 0; i < numCPUs; i++) {
            const worker = cluster.fork();
            worker.on("message", (message: TestSummary) => handleWorkerMessage(worker, message));
            processIdleWorker(worker);
        }
    });
}

async function processTest(testCase: { testSetName: string; test: string }) {
    const { testSetName, test } = testCase;
    const parsedTest = JSON.parse(test) as TestMethod;
    const testSets = await TestScanner.scan("./out/test/end2end/");
    const testSet = testSets.find(set => set.testConstructor.name === testSetName);
    if (testSet) {
        const taskSetInstance = new testSet.testConstructor();
        try {
            const testResult = await taskSetInstance.run(parsedTest, cluster.worker?.id);
            process.send?.(testResult);
        }
        catch {
            process.send?.({testStatus: false, time: 0});
        }
    }
}

async function runTests() {
    if (cluster.isPrimary) {
        const filter = (() => {
            if (process.argv[2]) {
                return new RegExp(`${process.argv[2]}`);
            }
            return undefined;
        })();
        
        const testSets = await TestScanner.scan("./out/test/end2end/", filter);
        const startTime = DateUtils.now();
        const failed = await runTestsInParallel(testSets);
        const endTime = DateUtils.now();
        const totalTime = (endTime - startTime) / 1000;
        
        console.log("\x1b[33mFINAL RESULTS:");
        console.log(`\x1b[33mTOTAL TIME: ${totalTime}s`);
        console.log(failed === 0 ? "\x1b[32mALL PASSED, SUCCESS" : `\x1b[31m ${failed} TESTS FAILED`);
        
        process.exit(failed ? 1 : 0);
    }
    else {
        process.on("message", (test: { testSetName: string; test: string }) => {
            void processTest(test);
        });
    }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
