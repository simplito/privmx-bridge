/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { LockApiValidator } from "../../api/main/lock/LockApiValidator";
import { Utils } from "../../utils/Utils";

function validate(method: string, model: unknown) {
    return Utils.try(() => new LockApiValidator().validate(method, model));
}

it("LockApiValidator.AcceptsSafeIds", () => {
    expect(validate("lockLock", {resourceId: "thread_ABC-123", uuid: "sess-42", lockLevel: "exclusive"}).success).toBe(true);
});

it("LockApiValidator.RejectsColonInResourceId", () => {
    // ":" is the key delimiter and must never appear in a client-supplied id
    expect(validate("lockLock", {resourceId: "a:b", uuid: "u", lockLevel: "shared"}).success).toBe(false);
});

it("LockApiValidator.RejectsUnsafeCharacters", () => {
    expect(validate("lockLock", {resourceId: "with space", uuid: "u", lockLevel: "shared"}).success).toBe(false);
    expect(validate("lockLock", {resourceId: "slash/path", uuid: "u", lockLevel: "shared"}).success).toBe(false);
    expect(validate("lockLock", {resourceId: "a*b", uuid: "u", lockLevel: "shared"}).success).toBe(false);
});

it("LockApiValidator.RejectsEmptyAndOverlongIds", () => {
    expect(validate("lockLock", {resourceId: "", uuid: "u", lockLevel: "shared"}).success).toBe(false);
    expect(validate("lockLock", {resourceId: "x".repeat(61), uuid: "u", lockLevel: "shared"}).success).toBe(false);
});

it("LockApiValidator.RejectsNoneOnLock", () => {
    // "none" is only reachable through unlock, never acquirable
    expect(validate("lockLock", {resourceId: "r", uuid: "u", lockLevel: "none"}).success).toBe(false);
});

it("LockApiValidator.UnlockOnlyAcceptsNoneOrShared", () => {
    expect(validate("lockUnlock", {resourceId: "r", uuid: "u", lockLevel: "none"}).success).toBe(true);
    expect(validate("lockUnlock", {resourceId: "r", uuid: "u", lockLevel: "shared"}).success).toBe(true);
    expect(validate("lockUnlock", {resourceId: "r", uuid: "u", lockLevel: "exclusive"}).success).toBe(false);
});

it("LockApiValidator.CheckReservedLockShape", () => {
    expect(validate("lockCheckReservedLock", {resourceId: "r", uuid: "u"}).success).toBe(true);
    expect(validate("lockCheckReservedLock", {resourceId: "r"}).success).toBe(false);
});
