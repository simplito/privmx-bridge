/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";

/**
 * Narrows a container's per-group key blobs to the groups the caller belongs to.
 *
 * Shared by every container converter because the rule has to be identical across them: a client orders its
 * attempts at the container key off this field, so a module that narrowed differently would give the same client
 * two different cost models.
 *
 * Only the outer list is narrowed. Each surviving entry keeps its whole `keys` array on purpose: entries at
 * older `keyId`s open content written under earlier container keys, so dropping them would cost the caller its
 * own group's history.
 *
 * Entries are **not** intersected with the container's current `groups`. A group whose grant was revoked keeps
 * its entries at the old `keyId`s (`buildGroupKeys` never removes), and a member of it can still read what was
 * written back then. Which grants are worth opening *now* is a different question, answered by
 * `keys.some(k => k.keyId === container.keyId)`: `CloudKeyService.verifyThatOnlyGivenGroupsHaveAccess` enforces
 * both directions of "has an entry at the current keyId" ⟺ "is currently granted", so that predicate is exact.
 *
 * @param ownGroupIds the caller's group ids. Never `undefined` on a path that serves this payload to a user —
 *                    passing it throws rather than narrowing to nothing, because an empty result here is
 *                    indistinguishable from "you hold no grant" and would silently strip key material the
 *                    caller needs. Callers that have no single caller (the plain API) use their own converters,
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
