/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { InMemoryLockStore } from "../../cluster/master/ipcServices/lock/InMemoryLockStore";
import { LOCK_TIMEOUT_MS } from "../../cluster/master/ipcServices/lock/LockTypes";

function createStore() {
    const clock = { now: 1_000 };
    const store = new InMemoryLockStore(() => clock.now);
    return { store, clock };
}

it("InMemoryLockStore.SharedReadersCoexist", async () => {
    const { store } = createStore();
    expect(await store.lock("r", "a", "shared")).toEqual({success: true, currentLevel: "shared"});
    expect(await store.lock("r", "b", "shared")).toEqual({success: true, currentLevel: "shared"});
    expect(await store.lock("r", "c", "shared")).toEqual({success: true, currentLevel: "shared"});
});

it("InMemoryLockStore.ReservedAllowsNewReaders_PendingBlocksThem", async () => {
    const { store } = createStore();
    expect(await store.lock("r", "a", "reserved")).toEqual({success: true, currentLevel: "reserved"});
    // reserved writer still admits new shared readers
    expect(await store.lock("r", "b", "shared")).toEqual({success: true, currentLevel: "shared"});
    // escalate the writer to pending
    expect(await store.lock("r", "a", "pending")).toEqual({success: true, currentLevel: "pending"});
    // pending writer blocks brand new readers
    expect(await store.lock("r", "c", "shared")).toEqual({success: false, currentLevel: "none"});
});

it("InMemoryLockStore.ExclusiveWaitsForReadersViaPending", async () => {
    const { store } = createStore();
    expect(await store.lock("r", "a", "shared")).toEqual({success: true, currentLevel: "shared"});
    // b cannot go exclusive while a reads; it parks at pending
    expect(await store.lock("r", "b", "exclusive")).toEqual({success: false, currentLevel: "pending"});
    // a new reader is now blocked by the pending writer
    expect(await store.lock("r", "c", "shared")).toEqual({success: false, currentLevel: "none"});
    // reader drains, b can now take exclusive
    expect(await store.unlock("r", "a", "none")).toEqual({success: true, currentLevel: "none"});
    expect(await store.lock("r", "b", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    // a foreign writer request fails
    expect(await store.lock("r", "d", "exclusive")).toEqual({success: false, currentLevel: "none"});
});

it("InMemoryLockStore.WriterIsSingleHolder", async () => {
    const { store } = createStore();
    expect(await store.lock("r", "a", "reserved")).toEqual({success: true, currentLevel: "reserved"});
    // b cannot take reserved while a holds a writer lock
    expect(await store.lock("r", "b", "reserved")).toEqual({success: false, currentLevel: "none"});
});

it("InMemoryLockStore.ReLockRenewsLeaseAsHeartbeat", async () => {
    const { store, clock } = createStore();
    expect(await store.lock("r", "a", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    // just before expiry, re-lock at the held level renews the lease
    clock.now += LOCK_TIMEOUT_MS - 1;
    expect(await store.lock("r", "a", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    // almost a full window later: still held thanks to the renewal above
    clock.now += LOCK_TIMEOUT_MS - 1;
    expect(await store.lock("r", "b", "exclusive")).toEqual({success: false, currentLevel: "none"});
});

it("InMemoryLockStore.LockExpiresWithoutRenewal", async () => {
    const { store, clock } = createStore();
    expect(await store.lock("r", "a", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    clock.now += LOCK_TIMEOUT_MS + 1;
    // a's lease lapsed, so b acquires cleanly
    expect(await store.lock("r", "b", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
});

it("InMemoryLockStore.CheckReservedLock", async () => {
    const { store } = createStore();
    expect(await store.checkReservedLock("r", "b")).toEqual({reserved: false});
    await store.lock("r", "a", "reserved");
    // another holder sees the reservation, the owner does not
    expect(await store.checkReservedLock("r", "b")).toEqual({reserved: true});
    expect(await store.checkReservedLock("r", "a")).toEqual({reserved: false});
    // a mere shared lock is not a reservation
    const { store: store2 } = createStore();
    await store2.lock("r", "a", "shared");
    expect(await store2.checkReservedLock("r", "b")).toEqual({reserved: false});
});

it("InMemoryLockStore.EmptyLockSetsArePruned", async () => {
    const { store } = createStore();
    expect(store.size()).toBe(0);
    await store.lock("r", "a", "shared");
    expect(store.size()).toBe(1);
    await store.unlock("r", "a", "none");
    expect(store.size()).toBe(0);
    // a failed acquisition must not leak an entry
    await store.lock("r", "a", "exclusive");
    expect(await store.lock("r", "b", "shared")).toEqual({success: false, currentLevel: "none"});
    await store.unlock("r", "a", "none");
    expect(store.size()).toBe(0);
    // read-only calls never create entries
    await store.checkReservedLock("never-seen", "x");
    expect(store.size()).toBe(0);
    await store.unlock("never-seen", "x", "none");
    expect(store.size()).toBe(0);
});

it("InMemoryLockStore.ExpiredLocksArePrunedOnAccess", async () => {
    const { store, clock } = createStore();
    await store.lock("r", "a", "exclusive");
    expect(store.size()).toBe(1);
    clock.now += LOCK_TIMEOUT_MS + 1;
    expect(await store.checkReservedLock("r", "b")).toEqual({reserved: false});
    expect(store.size()).toBe(0);
});

it("InMemoryLockStore.DowngradeExclusiveToShared", async () => {
    const { store } = createStore();
    await store.lock("r", "a", "exclusive");
    expect(await store.unlock("r", "a", "shared")).toEqual({success: true, currentLevel: "shared"});
    // writer slot freed, so another reader may join
    expect(await store.lock("r", "b", "shared")).toEqual({success: true, currentLevel: "shared"});
    // and the downgraded holder is now just a reader
    expect(await store.checkReservedLock("r", "b")).toEqual({reserved: false});
});

it("InMemoryLockStore.DistinctKeysAreIndependent", async () => {
    const { store } = createStore();
    expect(await store.lock("h1:r", "a", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    // same resource id under a different namespace is a different lock
    expect(await store.lock("h2:r", "b", "exclusive")).toEqual({success: true, currentLevel: "exclusive"});
    expect(await store.lock("h1:r", "b", "exclusive")).toEqual({success: false, currentLevel: "none"});
});
