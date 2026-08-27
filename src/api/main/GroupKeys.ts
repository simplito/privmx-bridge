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
 * Only the outer list is narrowed — a surviving entry keeps its whole `keys` array, because entries at older
 * `keyId`s open content written under earlier container keys. Nor are entries intersected with the container's
 * current `groups`: a revoked group's members can still read what was written while they had access.
 *
 * @param ownGroupIds the caller's group ids. `undefined` throws rather than narrowing to nothing — an empty
 *                    result is indistinguishable from "you hold no grant" and would silently strip key material.
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
 * Shared by `checkGroupEpochs` (which refuses a write when non-empty) and by every container converter (which
 * serves it as `staleGroups`), so a client is held to what it was told.
 *
 * Only the entry at `container.keyId` counts. Older entries accumulate one per rotation, so checking all of
 * them would mark a correctly re-keyed container stale forever. No entry at the current key means unwrapped.
 *
 * @param groupEpochs current epochs of the granted groups. A group absent from it is not reported: `groupKeys`
 *                    outlives a revoked grant on purpose, and the map only covers groups still granted, so
 *                    absence means "no longer granted", not "stale". `checkGroupEpochs` is where an unresolvable
 *                    *current* grant is refused.
 */
export function staleGroupsOf(
    container: {keyId: types.core.KeyId, groupKeys?: types.cloud.GroupKeysEntry[]},
    groupEpochs: GroupEpochs,
): types.group.GroupId[] {
    return (container.groupKeys || [])
        .filter(entry => {
            const atCurrentKey = entry.keys.find(k => k.keyId === container.keyId);
            if (atCurrentKey === undefined) {
                return false;
            }
            const currentEpoch = groupEpochs.get(entry.group);
            return currentEpoch !== undefined && (atCurrentKey.groupEpoch ?? 0) < currentEpoch;
        })
        .map(entry => entry.group);
}
