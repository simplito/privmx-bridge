/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";

/** Current epoch (`keyVersion`) per group, keyed by id — what `GroupRepository.getKeyVersions` returns. */
export type GroupEpochs = ReadonlyMap<types.group.GroupId, number>;

/**
 * Narrows a container's per-group key blobs to the groups the caller belongs to.
 *
 * Only the outer list is narrowed: entries at older `keyId`s open content written under earlier container keys,
 * so a surviving entry keeps its whole `keys` array. Entries are not intersected with the container's current
 * `groups` either — a revoked group keeps its old entries, and its members can still read what was written back
 * then.
 *
 * @param ownGroupIds the caller's group ids. `undefined` throws rather than narrowing to nothing, because an
 *                    empty result is indistinguishable from "you hold no grant" and would silently strip key
 *                    material the caller needs. The plain API has no single caller and uses its own converters,
 *                    which carry no key blobs at all.
 */
export function ownGroupKeysOf(
    groupKeys: types.cloud.GroupKeysEntry[],
    ownGroupIds: types.group.GroupId[]|undefined,
): types.cloud.GroupKeysEntry[] {
    if (ownGroupIds === undefined) {
        throw new Error("ownGroupKeysOf: ownGroupIds is undefined — a user-facing container payload cannot be narrowed without knowing the caller's groups");
    }
    return groupKeys.filter(entry => ownGroupIds.includes(entry.group));
}

/**
 * The grantee groups that have rotated past the epoch the container's **current** key was wrapped to.
 *
 * Shared by `BaseContainerService.checkGroupEpochs` (which refuses a write when this is non-empty) and by every
 * container converter (which serves it as `staleGroups`), so what a client is told before it writes is what it
 * is held to when it does.
 *
 * Only the entry at `container.keyId` counts — that is the key new content is encrypted under. Older entries
 * accumulate one per rotation, so checking all of them would mark a correctly re-keyed container stale forever.
 * No entry at the current key means unwrapped, not stale.
 *
 * @param groupEpochs current epochs of the container's granted groups. A group missing from it — deleted since
 *                    the grant was made — counts as epoch 1: enough to leave an epoch-1 wrap alone and to mark a
 *                    Phase-1 entry, which carries no epoch tag, as behind.
 */
export function staleGroupsOf(
    container: {keyId: types.core.KeyId, groupKeys?: types.cloud.GroupKeysEntry[]},
    groupEpochs: GroupEpochs,
): types.group.GroupId[] {
    return (container.groupKeys || [])
        .filter(entry => {
            const atCurrentKey = entry.keys.find(k => k.keyId === container.keyId);
            return atCurrentKey !== undefined && (atCurrentKey.groupEpoch ?? 0) < (groupEpochs.get(entry.group) ?? 1);
        })
        .map(entry => entry.group);
}
