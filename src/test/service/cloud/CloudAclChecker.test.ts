/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { AclFunctionNameX, CloudAclChecker } from "../../../service/cloud/CloudAclChecker";
import * as assert from "assert";
import * as types from "../../../types";
import { Utils } from "../../../utils/Utils";

function asAcl(acl: string|string[]) {
    return (typeof(acl) === "string" ? acl : acl.join("\n")) as types.cloud.ContextAcl;
}

describe("CloudAclChecker.verifyAccess", () => {
    each<[string|string[], AclFunctionNameX, string[], boolean]>([
        ["ALLOW ALL", "store/storeGet", [], true],
        ["DENY ALL", "store/storeGet", [], false],
        ["ALLOW ALL", "misc/funcDoesNotExist" as any, [], false],
        ["ALLOW store/ALL", "store/storeGet", [], true],
        ["ALLOW store/ALL", "store/storeCreate", [], true],
        ["ALLOW store/READ", "store/storeGet", [], true],
        ["ALLOW store/READ", "store/storeCreate", [], false],
        ["ALLOW store/WRITE", "store/storeGet", [], false],
        ["ALLOW store/WRITE", "store/storeCreate", [], true],
        ["ALLOW store/storeCreate", "store/storeCreate", [], true],
        [[
            "ALLOW ALL",
            "DENY stream/streamRoomDeleteMany",
            "ALLOW ALL",
        ], "stream/streamRoomDeleteMany", [], true],
        [[
            "ALLOW store/storeFileList",
            "DENY store/READ",
        ], "store/storeFileList", [], false],
        [[
            "ALLOW store/storeGet storeId=zxc",
            "DENY store/READ",
        ], "store/storeGet", ["storeId=zxc"], false],
        [[
            "DENY store/READ",
            "ALLOW store/storeGet storeId=zxc",
        ], "store/storeGet", ["storeId=zxc"], true],
        [[
            "DENY store/READ",
            "ALLOW store/storeGet storeId=zxc",
        ], "store/storeGet", ["storeId=qwe"], false],
        [[
            "ALLOW ALL",
            "DENY thread/threadMessageGet",
        ], "thread/threadMessageGet", [], false],
        [[
            "DENY ALL",
            "ALLOW thread/threadMessageGet",
        ], "thread/threadMessageGet", [], true],
        [[
            "ALLOW ALL",
            "DENY store/WRITE",
            "ALLOW store/storeUpdate",
        ], "store/storeUpdate", [], true],
        [[
            "DENY ALL",
            "ALLOW thread/WRITE",
        ], "thread/threadMessageGet", [], false],
    ]).it("input=%s", async ([acl, fnName, args, valid]) => {
        const cloudAclChecker = new CloudAclChecker();
        const res = Utils.try(() => cloudAclChecker.verifyAccess(asAcl(acl), fnName, args));
        if (res.success === true) {
            assert(valid, "Should throw exception");
        }
        else {
            assert(!valid, "Should not throw exception");
        }
    });
});

describe("CloudAclChecker.validateAcl", () => {
    each<[string|string[], boolean]>([
        ["ALLOW ALL", true],
        ["ALLOW misc/funcDoesNotExist", false],
        ["ALLOW store/storeGet", true],
        ["ALLOW store/storeGet storeId=zxc", true],
        ["ALLOW store/storeGet abc=zxc", false],
        ["allow ALL", false],
        ["deny ALL", false],
        ["qwerty", false],
        [[
            "ALLOW ALL",
            "qwerty",
        ], false],
        [[
            "ALLOW ALL",
            "DENY stream/streamRoomDeleteMany",
            "ALLOW ALL",
        ], true],
        [[
            "ALLOW store/storeFileList",
            "DENY store/READ",
        ], true],
        [[
            "ALLOW store/storeGet storeId=zxc",
            "DENY store/READ",
        ], true],
        [[
            "ALLOW ALL",
            "DENY thread/threadMessageGet",
        ], true],
        [[
            "DENY ALL",
            "ALLOW thread/threadMessageGet",
        ], true],
        [[
            "ALLOW ALL",
            "DENY store/WRITE",
            "ALLOW store/storeUpdate",
        ], true],
        [[
            "DENY ALL",
            "ALLOW thread/WRITE",
        ], true],
        [[
            "ALLOW ALL DENY stream/streamRoomDeleteMany",
            "ALLOW ALL",
        ], false],
        [[
            "allow all",
            "deny stream/streamRoomDeleteMany",
        ], false],
    ]).it("input=%s %s", async ([acl, valid]) => {
        const cloudAclChecker: CloudAclChecker = new CloudAclChecker();
        const res = Utils.try(() => cloudAclChecker.validateAcl(asAcl(acl), 1000));
        if (res.success === true) {
            assert(valid, "Should throw exception");
        }
        else {
            assert(!valid, "Should not throw exception");
        }
    });
});
