/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { LockStore } from "./LockStore";
import {
    LOCK_LEVEL_NAME,
    LOCK_LEVEL_ORDER,
    LOCK_TIMEOUT_MS,
    LockLevelNumeric,
    LockResult,
    UnlockLevel,
    WriteableLockLevel,
} from "./LockTypes";

interface Lock {
    lockId: string;
    timestamp: number;
    level: LockLevelNumeric;
}

interface LockSet {
    writerLock: Lock | null;
    readerLocks: Map<string, Lock>;
}

/**
 * In-process {@link LockStore} backed by a plain Map.
 *
 * Correctness relies on running inside the single-threaded master process: every
 * public method is synchronous end-to-end (no `await` inside a method body), so a
 * call cannot interleave with another on the same key. Empty lock sets are pruned
 * eagerly so the map never accumulates entries for released resources.
 *
 * The clock is injected so lease-timeout behaviour is deterministic in tests and
 * so a future distributed backend can centralise the time source.
 */
export class InMemoryLockStore implements LockStore {
    
    private readonly locks = new Map<string, LockSet>();
    
    constructor(
        private readonly now: () => number = () => Date.now(),
    ) {}
    
    async lock(key: string, uuid: string, lockLevel: WriteableLockLevel): Promise<LockResult> {
        const level = LOCK_LEVEL_ORDER[lockLevel];
        const lockSet = this.getOrCreateLockSet(key);
        this.deleteTimeoutedLocks(lockSet);
        const myLock = this.getMyLock(lockSet, uuid);
        
        try {
            // Already hold this level (or stronger): renew the lease and report success.
            if (myLock.level >= level) {
                myLock.timestamp = this.now();
                return this.result(true, myLock.level);
            }
            
            if (level === LOCK_LEVEL_ORDER.shared) {
                // A reserved writer still admits new readers; pending/exclusive do not.
                if (lockSet.writerLock !== null && lockSet.writerLock.level !== LOCK_LEVEL_ORDER.reserved) {
                    return this.result(false, myLock.level);
                }
                lockSet.readerLocks.set(uuid, this.createLock(uuid, LOCK_LEVEL_ORDER.shared));
                return this.result(true, LOCK_LEVEL_ORDER.shared);
            }
            
            if (level === LOCK_LEVEL_ORDER.reserved || level === LOCK_LEVEL_ORDER.pending) {
                if (lockSet.writerLock !== null && lockSet.writerLock.lockId !== uuid) {
                    return this.result(false, myLock.level);
                }
                this.deleteMyLocks(lockSet, uuid);
                lockSet.writerLock = this.createLock(uuid, level);
                return this.result(true, level);
            }
            
            // level === exclusive
            if (lockSet.writerLock !== null && lockSet.writerLock.lockId !== uuid) {
                return this.result(false, myLock.level);
            }
            this.deleteMyLocks(lockSet, uuid);
            if (lockSet.readerLocks.size > 0) {
                // Readers still present: hold pending to block new readers and wait for them to drain.
                lockSet.writerLock = this.createLock(uuid, LOCK_LEVEL_ORDER.pending);
                return this.result(false, LOCK_LEVEL_ORDER.pending);
            }
            lockSet.writerLock = this.createLock(uuid, LOCK_LEVEL_ORDER.exclusive);
            return this.result(true, LOCK_LEVEL_ORDER.exclusive);
        }
        finally {
            this.pruneIfEmpty(key, lockSet);
        }
    }
    
    async unlock(key: string, uuid: string, unlockLevel: UnlockLevel): Promise<LockResult> {
        const level = LOCK_LEVEL_ORDER[unlockLevel];
        const lockSet = this.locks.get(key);
        if (!lockSet) {
            return this.result(true, LOCK_LEVEL_ORDER.none);
        }
        this.deleteTimeoutedLocks(lockSet);
        const myLock = this.getMyLock(lockSet, uuid);
        
        try {
            // Nothing to downgrade (already at or below the requested level).
            if (myLock.level <= level) {
                return this.result(true, myLock.level);
            }
            
            if (level === LOCK_LEVEL_ORDER.none) {
                this.deleteMyLocks(lockSet, uuid);
                return this.result(true, LOCK_LEVEL_ORDER.none);
            }
            
            // level === shared: downgrade a writer lock to a shared reader lock.
            // Only the caller's own writer lock can have a level above shared, so
            // removing it always clears the single writer slot.
            this.deleteMyLocks(lockSet, uuid);
            lockSet.readerLocks.set(uuid, this.createLock(uuid, LOCK_LEVEL_ORDER.shared));
            return this.result(true, LOCK_LEVEL_ORDER.shared);
        }
        finally {
            this.pruneIfEmpty(key, lockSet);
        }
    }
    
    async checkReservedLock(key: string, uuid: string): Promise<{reserved: boolean}> {
        const lockSet = this.locks.get(key);
        if (!lockSet) {
            return { reserved: false };
        }
        this.deleteTimeoutedLocks(lockSet);
        const reserved = lockSet.writerLock !== null &&
            lockSet.writerLock.lockId !== uuid &&
            lockSet.writerLock.level >= LOCK_LEVEL_ORDER.reserved;
        this.pruneIfEmpty(key, lockSet);
        return { reserved };
    }
    
    /** Number of resources currently tracked. Exposed for tests/diagnostics. */
    size(): number {
        return this.locks.size;
    }
    
    private result(success: boolean, level: LockLevelNumeric): LockResult {
        return { success, currentLevel: LOCK_LEVEL_NAME[level] };
    }
    
    private getOrCreateLockSet(key: string): LockSet {
        let lockSet = this.locks.get(key);
        if (!lockSet) {
            lockSet = { writerLock: null, readerLocks: new Map() };
            this.locks.set(key, lockSet);
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
        return { lockId: uuid, timestamp: this.now(), level };
    }
    
    private deleteMyLocks(lockSet: LockSet, uuid: string): void {
        if (lockSet.writerLock !== null && lockSet.writerLock.lockId === uuid) {
            lockSet.writerLock = null;
        }
        lockSet.readerLocks.delete(uuid);
    }
    
    private deleteTimeoutedLocks(lockSet: LockSet): void {
        const timeoutTimestamp = this.now() - LOCK_TIMEOUT_MS;
        if (lockSet.writerLock !== null && lockSet.writerLock.timestamp <= timeoutTimestamp) {
            lockSet.writerLock = null;
        }
        for (const [id, lock] of lockSet.readerLocks) {
            if (lock.timestamp <= timeoutTimestamp) {
                lockSet.readerLocks.delete(id);
            }
        }
    }
    
    private pruneIfEmpty(key: string, lockSet: LockSet): void {
        if (lockSet.writerLock === null && lockSet.readerLocks.size === 0) {
            this.locks.delete(key);
        }
    }
}
