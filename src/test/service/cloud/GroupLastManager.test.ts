/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../../types";
import { GroupService } from "../../../service/cloud/GroupService";
import { AppException, ERROR_CODES } from "../../../api/AppException";

const users = (...ids: string[]) => ids as types.cloud.UserId[];

function codeOf(run: () => void): number|undefined {
    try {
        run();
        return undefined;
    }
    catch (e) {
        return e instanceof AppException ? e.getCode() : -1;
    }
}

it("SECURITY: a removal that would leave a managed group without a manager is refused", async () => {
    expect(codeOf(() => GroupService.assertKeepsAManager(users("alice"), users()))).toBe(ERROR_CODES.GROUP_LAST_MANAGER.code);
    expect(codeOf(() => GroupService.assertKeepsAManager(users("alice", "bob"), users()))).toBe(ERROR_CODES.GROUP_LAST_MANAGER.code);
});

it("a removal that leaves a manager is taken", async () => {
    expect(codeOf(() => GroupService.assertKeepsAManager(users("alice", "bob"), users("alice"))) === undefined).toBe(true);
    expect(codeOf(() => GroupService.assertKeepsAManager(users("alice"), users("alice"))) === undefined).toBe(true);
});

it("a group created with no manager stays as it is: a roster frozen on purpose", async () => {
    expect(codeOf(() => GroupService.assertKeepsAManager(users(), users())) === undefined).toBe(true);
});
