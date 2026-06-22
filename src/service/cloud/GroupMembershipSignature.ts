/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { Crypto } from "../../utils/crypto/Crypto";
import { ECUtils } from "../../utils/crypto/ECUtils";

/**
 * Canonical serialization + verification of the signed group membership log.
 *
 * The bridge is untrusted, so every membership-mutating group operation (create / update /
 * modifyMembers) is signed by its author with their context private key. The bridge stores the
 * signature in an append-only, chained history (each entry links to the previous via prevSignature)
 * and serves the whole chain; the privmx-endpoint library replays and verifies it client-side.
 *
 * CONTRACT (must match byte-for-byte between privmx-bridge and privmx-endpoint):
 *   message = sha256( canonical )                       // signed/verified value
 *   canonical = concat of length-prefixed fields, in the FIXED order below.
 *
 * Field encoding:
 *   - string field: uint32be(byteLength) || utf8Bytes
 *   - list field:   uint32be(count) || (string field for each element, elements sorted ascending
 *                   by their UTF-8 byte sequence so order on the wire is irrelevant to the signer)
 *
 * The group is anchored by its groupPubKey (the client-generated cryptographic identity, known at
 * signing time) plus the prevSignature chain — NOT by the server-assigned groupId, which does not exist
 * yet when the genesis (create) entry is signed.
 *
 * Field order:
 *   0  DOMAIN            ("PMX_GROUP_SIG")
 *   1  SIG_VERSION       (decimal string, currently "1")
 *   2  op                ("create" | "update" | "modifyMembers")
 *   3  contextId
 *   4  author (userId)
 *   5  authorPubKey
 *   6  groupPubKey
 *   7  keyId
 *   8  prevSignature     ("" for the genesis/create entry)
 *   9  resultUsers       (sorted list — the resulting full members set the bridge enforces)
 *   10 resultManagers    (sorted list — the resulting full managers set the bridge enforces)
 *   -- the following four are present ONLY when op === "modifyMembers" --
 *   11 usersAdded        (sorted list)
 *   12 usersRemoved      (sorted list)
 *   13 managersAdded     (sorted list)
 *   14 managersRemoved   (sorted list)
 *
 * The signature is the 65-byte compact ECDSA signature (recovery byte || r || s), Base64-encoded as
 * types.core.EccSignature — identical to every other signature on the wire (see ECUtils).
 */

export const GROUP_SIG_DOMAIN = "PMX_GROUP_SIG";
export const GROUP_SIG_VERSION = 1;

export interface GroupSignaturePayload {
    op: types.group.GroupSignatureOp;
    contextId: types.context.ContextId;
    author: types.cloud.UserId;
    authorPubKey: types.cloud.UserPubKey;
    groupPubKey: types.cloud.GroupPubKey;
    keyId: types.core.KeyId;
    prevSignature: types.core.EccSignature | null;
    /** The resulting full member set the bridge will enforce after this operation. */
    resultUsers: types.cloud.UserId[];
    resultManagers: types.cloud.UserId[];
    /** Present only for op === "modifyMembers". */
    delta?: types.group.GroupMembersDelta;
}

export class GroupMembershipSignature {
    
    private static writeString(value: string): Buffer {
        const data = Buffer.from(value, "utf8");
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        return Buffer.concat([len, data]);
    }
    
    private static writeList(values: string[]): Buffer {
        const sorted = [...values].sort();
        const count = Buffer.alloc(4);
        count.writeUInt32BE(sorted.length, 0);
        return Buffer.concat([count, ...sorted.map(v => GroupMembershipSignature.writeString(v))]);
    }
    
    /** Builds the byte-stable canonical buffer for the given payload. */
    static buildCanonical(payload: GroupSignaturePayload): Buffer {
        const parts: Buffer[] = [
            GroupMembershipSignature.writeString(GROUP_SIG_DOMAIN),
            GroupMembershipSignature.writeString(String(GROUP_SIG_VERSION)),
            GroupMembershipSignature.writeString(payload.op),
            GroupMembershipSignature.writeString(payload.contextId),
            GroupMembershipSignature.writeString(payload.author),
            GroupMembershipSignature.writeString(payload.authorPubKey),
            GroupMembershipSignature.writeString(payload.groupPubKey),
            GroupMembershipSignature.writeString(payload.keyId),
            GroupMembershipSignature.writeString(payload.prevSignature || ""),
            GroupMembershipSignature.writeList(payload.resultUsers),
            GroupMembershipSignature.writeList(payload.resultManagers),
        ];
        if (payload.op === "modifyMembers") {
            const delta = payload.delta || {usersAdded: [], usersRemoved: [], managersAdded: [], managersRemoved: []};
            parts.push(
                GroupMembershipSignature.writeList(delta.usersAdded),
                GroupMembershipSignature.writeList(delta.usersRemoved),
                GroupMembershipSignature.writeList(delta.managersAdded),
                GroupMembershipSignature.writeList(delta.managersRemoved),
            );
        }
        return Buffer.concat(parts);
    }
    
    /** The sha256 digest that is actually signed/verified. */
    static digest(payload: GroupSignaturePayload): Buffer {
        return Crypto.sha256(GroupMembershipSignature.buildCanonical(payload));
    }
    
    /** Verifies the author's signature over the canonical payload. */
    static verify(signature: types.core.EccSignature, payload: GroupSignaturePayload): boolean {
        return ECUtils.verifySignature2(payload.authorPubKey, signature, GroupMembershipSignature.digest(payload));
    }
}
