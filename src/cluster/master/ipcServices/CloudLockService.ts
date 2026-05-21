/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ApiMethod } from "../../../api/Decorators";
import { IpcService } from "../Decorators";

export type LockLevel = "none" | "shared" | "reserved" | "pending" | "exclusive";
type LockLevelNumeric = 0 | 1 | 2 | 3 | 4;

export interface LockResult {
    success: boolean;
    currentLevel: LockLevel;
}

interface Lock {
    lockId: string;
    timestamp: number;
    level: LockLevelNumeric;
}

interface LockSet {
    writerLock: Lock | null;
    readerLocks: Map<string, Lock>;
}

const LOCK_LEVEL_ORDER: Record<LockLevel, LockLevelNumeric> = {
    none: 0,
    shared: 1,
    reserved: 2,
    pending: 3,
    exclusive: 4,
};

const LOCK_LEVEL_NAME: LockLevel[] = ["none", "shared", "reserved", "pending", "exclusive"];

const TIMEOUT_DELTA = 30_000;

@IpcService
export class CloudLockService {
    
    private locks = new Map<string, LockSet>();
    
    @ApiMethod({})
    async resourceLock(model: {resourceId: string, uuid: string, lockLevel: Exclude<LockLevel, "none">}): Promise<LockResult> {
        const lockSet = this.getOrCreateLockSet(model.resourceId);
        const level = LOCK_LEVEL_ORDER[model.lockLevel];
        const myLock = this.getMyLock(lockSet, model.uuid);
        
        if (myLock.level >= level) {
            return { success: true, currentLevel: LOCK_LEVEL_NAME[myLock.level] };
        }
        
        this.deleteTimeoutedLocks(lockSet);
        
        if (level === LOCK_LEVEL_ORDER.shared) {
            if (lockSet.writerLock !== null && lockSet.writerLock.level !== LOCK_LEVEL_ORDER.reserved) {
                return { success: false, currentLevel: LOCK_LEVEL_NAME[this.getMyLock(lockSet, model.uuid).level] };
            }
            lockSet.readerLocks.set(model.uuid, this.createLock(model.uuid, level));
            return { success: true, currentLevel: "shared" };
        }
        
        if (level === LOCK_LEVEL_ORDER.reserved || level === LOCK_LEVEL_ORDER.pending) {
            if (lockSet.writerLock !== null && lockSet.writerLock.lockId !== model.uuid) {
                return { success: false, currentLevel: LOCK_LEVEL_NAME[this.getMyLock(lockSet, model.uuid).level] };
            }
            this.deleteMyLocks(lockSet, model.uuid);
            lockSet.writerLock = this.createLock(model.uuid, level);
            return { success: true, currentLevel: LOCK_LEVEL_NAME[level] };
        }
        
        if (level === LOCK_LEVEL_ORDER.exclusive) {
            if (lockSet.writerLock !== null && lockSet.writerLock.lockId !== model.uuid) {
                return { success: false, currentLevel: LOCK_LEVEL_NAME[this.getMyLock(lockSet, model.uuid).level] };
            }
            this.deleteMyLocks(lockSet, model.uuid);
            if (lockSet.readerLocks.size > 0) {
                if (myLock.level === LOCK_LEVEL_ORDER.pending) {
                    return { success: false, currentLevel: "pending" };
                }
                lockSet.writerLock = this.createLock(model.uuid, LOCK_LEVEL_ORDER.pending);
                return { success: false, currentLevel: "pending" };
            }
            lockSet.writerLock = this.createLock(model.uuid, level);
            return { success: true, currentLevel: "exclusive" };
        }
        
        return { success: false, currentLevel: "none" };
    }
    
    @ApiMethod({})
    async resourceCheckReservedLock(model: {resourceId: string, uuid: string}): Promise<{reserved: boolean}> {
        const lockSet = this.getOrCreateLockSet(model.resourceId);
        this.deleteTimeoutedLocks(lockSet);
        const reserved = lockSet.writerLock !== null &&
            lockSet.writerLock.lockId !== model.uuid &&
            lockSet.writerLock.level >= LOCK_LEVEL_ORDER.reserved;
        return { reserved };
    }
    
    @ApiMethod({})
    async resourceUnlock(model: {resourceId: string, uuid: string, lockLevel: "none" | "shared"}): Promise<LockResult> {
        const lockSet = this.getOrCreateLockSet(model.resourceId);
        const level = LOCK_LEVEL_ORDER[model.lockLevel];
        const myLock = this.getMyLock(lockSet, model.uuid);
        
        if (myLock.level <= level) {
            return { success: true, currentLevel: LOCK_LEVEL_NAME[myLock.level] };
        }
        
        this.deleteTimeoutedLocks(lockSet);
        
        if (level === LOCK_LEVEL_ORDER.none) {
            this.deleteMyLocks(lockSet, model.uuid);
            return { success: true, currentLevel: "none" };
        }
        
        if (level === LOCK_LEVEL_ORDER.shared) {
            this.deleteMyLocks(lockSet, model.uuid);
            if (lockSet.writerLock !== null) {
                return { success: false, currentLevel: LOCK_LEVEL_NAME[this.getMyLock(lockSet, model.uuid).level] };
            }
            lockSet.readerLocks.set(model.uuid, this.createLock(model.uuid, level));
            return { success: true, currentLevel: "shared" };
        }
        
        return { success: false, currentLevel: LOCK_LEVEL_NAME[this.getMyLock(lockSet, model.uuid).level] };
    }
    
    private getOrCreateLockSet(resourceId: string): LockSet {
        let lockSet = this.locks.get(resourceId);
        if (!lockSet) {
            lockSet = { writerLock: null, readerLocks: new Map() };
            this.locks.set(resourceId, lockSet);
        }
        return lockSet;
    }
    
    private getMyLock(lockSet: LockSet, uuid: string): Lock {
        if (lockSet.writerLock !== null && lockSet.writerLock.lockId === uuid) {
            return lockSet.writerLock;
        }
        return lockSet.readerLocks.get(uuid) ?? { lockId: uuid, timestamp: 0, level: 0 };
    }
    
    private createLock(uuid: string, level: LockLevelNumeric): Lock {
        return { lockId: uuid, timestamp: Date.now(), level };
    }
    
    private deleteMyLocks(lockSet: LockSet, uuid: string): void {
        if (lockSet.writerLock !== null && lockSet.writerLock.lockId === uuid) {
            lockSet.writerLock = null;
        }
        lockSet.readerLocks.delete(uuid);
    }
    
    private deleteTimeoutedLocks(lockSet: LockSet): void {
        const timeoutTimestamp = Date.now() - TIMEOUT_DELTA;
        if (lockSet.writerLock !== null && lockSet.writerLock.timestamp <= timeoutTimestamp) {
            lockSet.writerLock = null;
        }
        for (const [id, lock] of lockSet.readerLocks) {
            if (lock.timestamp <= timeoutTimestamp) {
                lockSet.readerLocks.delete(id);
            }
        }
    }
}
