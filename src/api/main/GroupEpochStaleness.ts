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
 * The grantee groups that have rotated past the epoch the container's **current** key was wrapped to.
 *
 * One function, two callers, on purpose: `BaseContainerService.checkGroupEpochs` refuses a write when this is
 * non-empty, and every container converter serves it to the client as `staleGroups`. A second implementation of
 * the rule would eventually tell a client a container is fine and then refuse its next message.
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
