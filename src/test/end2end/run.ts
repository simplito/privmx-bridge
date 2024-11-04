/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */
import { TestScanner } from "./BaseTestSet";

async function runTests() {
    const filter = (() => {
        if (process.argv[2] && process.argv[2]) {
            return new RegExp(`${process.argv[2]}`);
        }
        return undefined;
    })();

    const testSets = await TestScanner.scan("./out/test/end2end/", filter);
    let totalTime: number = 0;
    let totalFailed: number  = 0;
    for (const testSet of testSets) {
        console.log("\x1b[33m==========================");
        console.log("\x1b[33m", testSet.testConstructor.name, "running");
        console.log("\x1b[33m==========================");
        for (const test of testSet.tests) {
            const testSetInstance = new testSet.testConstructor();
            const testResult = await testSetInstance.run(test);
            totalTime += testResult.time;
            totalFailed += (testResult.testStatus) ? 0 : 1;
        }
    }

    console.log("\x1b[33mFINAL RESULTS:");
    console.log(`\x1b[33mTOTAL TIME: ${totalTime}s`);
    console.log(`${(totalFailed == 0) ? "\x1b[32mALL PASSED, SUCCESS" : `\x1b[31m ${totalFailed} TESTS FAILED`}`);
    
    process.exit(totalFailed ? 1 : 0);
};

runTests().catch(e => {
    console.log(e);
    process.exit(1);
});
