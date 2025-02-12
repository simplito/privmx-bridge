/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { Utils } from "../../utils/Utils";

each<[number, number, number[]]>([
    [0, 0, [0]],
    [1, 1, [1]],
    [1, 0, []],
    [1, 2, [1, 2]],
    [1, 5, [1, 2, 3, 4, 5]],
]).it("Utils.createRange when range is from %s to %s result should be %s", ([a, b, expected]) => {
    const range = Utils.createRange(a, b);
    expect(range).toEqual(expected);
});

it("Utils.findMin2", () => {
    const value = Utils.findMin2([5, 4, 1, 6, 8, 4, 2], (a, b) => a - b);
    expect(value).toEqual(1);
});

it("Utils.findMax2", () => {
    const value = Utils.findMax2([5, 4, 1, 6, 8, 4, 2], (a, b) => a - b);
    expect(value).toEqual(8);
});
