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
 * The epoch each grant's wrap of the container's **current** key was made at, attached to the grant.
 *
 * This is what lets a client answer "does this container need re-keying?" without asking the bridge: it holds the
 * epoch the container was wrapped at, and it learns the group's current epoch from `groupList`, `groupGet` or a
 * `groupUpdated` event. The bridge does not compute the comparison, so a container read costs it no group lookup.
 *
 * Served on `groups`, which is **not** narrowed to the caller's own groups, and deliberately so: the manager who
 * has to re-key is often a member of none of the granted groups, and the epoch of a group's wrap is no more
 * secret than the grant itself.
 *
 * `groupEpoch` is absent when the current key is not wrapped to that group, and `0` when the wrap carries no
 * epoch tag at all — see `types.cloud.GroupGrantInfo`, which spells out what a client does with each.
 *
 * Reads the same wrap `staleGroupsOf` compares, and must keep doing so: the two answer the same question from
 * opposite ends, one for the client and one for the write path.
 */
export function grantsWithEpochOf(
    container: {keyId: types.core.KeyId, groups?: types.cloud.GroupGrant[], groupKeys?: types.cloud.GroupKeysEntry[]},
): types.cloud.GroupGrantInfo[] {
    return (container.groups || []).map(grant => {
        const entry = (container.groupKeys || []).find(x => x.group === grant.groupId);
        const atCurrentKey = entry?.keys.find(k => k.keyId === container.keyId);
        return atCurrentKey === undefined ? grant : {...grant, groupEpoch: atCurrentKey.groupEpoch ?? 0};
    });
}

/**
 * The grantee groups that have rotated past the epoch the container's **current** key was wrapped to.
 *
 * The write-side half of the pair: `BaseContainerService.checkGroupEpochs` refuses a write while this is
 * non-empty, and a client predicts that refusal by applying the rule in `types.cloud.GroupGrantInfo` to the
 * `groupEpoch` values `grantsWithEpochOf` served it. Both must read the same wrap, or a client would be told a
 * container is fine and then refused its next message.
 *
 * Only the entry at `container.keyId` counts — that is the key new content is encrypted under. Older entries are
 * kept by design (they open what was written before the last re-key) and one accumulates per rotation, so a check
 * across all of them would mark a correctly re-keyed container stale forever.
 *
 * No entry at the current key means unwrapped, not stale: nobody reads this content through that group.
 *
 * Iterating `groupKeys` rather than `groups` is exact, not a shortcut:
 * `CloudKeyService.verifyThatOnlyGivenGroupsHaveAccess` enforces both directions of "has an entry at the current
 * keyId" ⟺ "is currently granted", so a revoked group cannot reach the comparison at all.
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
