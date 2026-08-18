/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type LockLevel = "none" | "shared" | "reserved" | "pending" | "exclusive";

export interface LockLockModel {
    resourceId: string;
    uuid: string;
    lockLevel: Exclude<LockLevel, "none">;
}

export interface LockUnlockModel {
    resourceId: string;
    uuid: string;
    lockLevel: "none" | "shared";
}

export interface LockOperationResult {
    success: boolean;
    currentLevel: LockLevel;
}

export interface LockCheckReservedLockModel {
    resourceId: string;
    uuid: string;
}

export interface LockCheckReservedLockResult {
    reserved: boolean;
}

export interface ILockApi {
    lockLock(model: LockLockModel): Promise<LockOperationResult>;
    lockUnlock(model: LockUnlockModel): Promise<LockOperationResult>;
    lockCheckReservedLock(model: LockCheckReservedLockModel): Promise<LockCheckReservedLockResult>;
}
