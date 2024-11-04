/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { FieldPathParser, PropPathPart } from "../../utils/FieldPathParser";
import { Utils } from "../../utils/Utils";

it("asd", () => {
    FieldPathParser.parseFieldPath("as");
});

describe("FieldPathParser.parseFieldPath", () => {
    each<[string, false|PropPathPart[]]>([
        ["fieldName", [{type: "field", name: "fieldName"}]],
        ["_fieldName", [{type: "field", name: "_fieldName"}]],
        ["8fieldName", false],
        [".", false],
        [".fieldName", false],
        [".fieldName", false],
        ["[562]", [{type: "index", index: 562}]],
        ["[562][123]", [{type: "index", index: 562}, {type: "index", index: 123}]],
        ["fieldName.abc[562][123].as[0].qw", [{type: "field", name: "fieldName"}, {type: "field", name: "abc"}, {type: "index", index: 562}, {type: "index", index: 123}, {type: "field", name: "as"}, {type: "index", index: 0}, {type: "field", name: "qw"}]],
        ["[]", false],
        ["[8a8]", false],
        ["@abc", false],
        ["abc.8qwe", false],
    ]).it("input=%s", async ([input, expected]) => {
        // Act
        const result = Utils.try(() => FieldPathParser.parseFieldPath(input));
        
        // Assert
        if (result.success === true) {
            expect(expected).not.toBe(false);
            expect(JSON.stringify(result.result)).toBe(JSON.stringify(expected));
        }
        else {
            if (expected !== false) {
                expect(result.error).toBe(expected);
            }
        }
    });
});

describe("FieldPathParser.extractFromParsedPath", () => {
    each<[string, unknown, unknown]>([
        ["", 1, 1],
        ["abc", {abc: 2}, 2],
        ["abc.zxc", {abc: {zxc: 3}}, 3],
        ["[1]", [5, 6, 7], 6],
        ["abc[2].zxc[0]", {abc: [5, 6, {zxc: [9, 0, 1]}, 8]}, 9],
        ["j.k.l", {}, undefined],
        ["[0][2][1]", [[]], undefined],
    ]).it("input=%s", async ([input, obj, expected]) => {
        // Act
        const result = FieldPathParser.extract(obj, input);
        
        // Assert
        expect(result).toBe(expected);
    });
});

