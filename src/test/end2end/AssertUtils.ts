/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AssertionError } from "assert";

export function expect(actual: unknown) {
    let theContext: string|undefined;
    const obj = {
        toBe: (expected: unknown) => {
            if (actual !== expected) {
                throw new AssertionError({message: theContext, actual, expected, operator: "==="});
            }
        },
        withContext: (context: string) => {
            theContext = context;
            return obj;
        },
    };
    return obj;
}
