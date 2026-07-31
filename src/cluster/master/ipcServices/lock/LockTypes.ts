/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Hierarchical lock levels, modelled on SQLite's locking scheme.
 * The ordering is significant: a higher level always subsumes the lower ones.
 *
 * - none      no lock held
 * - shared    read lock; many holders may coexist
 * - reserved  intent-to-write; a single holder, still allows new shared readers
 * - pending   like reserved, but blocks new shared readers (escalation towards exclusive)
 * - exclusive single writer, no other holders
 */
export type LockLevel = "none" | "shared" | "reserved" | "pending" | "exclusive";

/** Levels that can be acquired via `lock` ("none" is only reachable through `unlock`). */
export type WriteableLockLevel = Exclude<LockLevel, "none">;

/** Levels that `unlock` can downgrade to. */
export type UnlockLevel = "none" | "shared";

export type LockLevelNumeric = 0 | 1 | 2 | 3 | 4;

export interface LockResult {
    success: boolean;
    currentLevel: LockLevel;
}

export const LOCK_LEVEL_ORDER: Record<LockLevel, LockLevelNumeric> = {
    none: 0,
    shared: 1,
    reserved: 2,
    pending: 3,
    exclusive: 4,
};

export const LOCK_LEVEL_NAME: LockLevel[] = ["none", "shared", "reserved", "pending", "exclusive"];

/**
 * A lock is automatically released if it is not renewed within this window.
 * Renewal happens implicitly whenever the holder re-issues a `lock` request at
 * the level it already holds (see {@link LockStore.lock}).
 */
export const LOCK_TIMEOUT_MS = 30_000;
