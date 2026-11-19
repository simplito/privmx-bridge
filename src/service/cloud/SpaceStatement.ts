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
import { ByteWriter } from "./keytree/ByteWriter";

type Recipients = Pick<types.cloud.SpaceStatement, "groups"|"users">;

/**
 * One signed entry of a space's history: who its recipients are after a change, which version of its key
 * they hold, and who made the change in which standing. The bytes are the ones the Endpoint signs and replays;
 * the bridge checks that an entry continues the history and describes the state it stores, and leaves the
 * question of whether the signer was entitled to the readers.
 */
export class SpaceStatement {
    
    static readonly OP_CODES: Record<types.cloud.SpaceStatementOp, number> = {create: 1, add: 2, remove: 3, rotate: 4};
    
    private static sorted<T>(list: T[], id: (x: T) => string): T[] {
        return [...list].sort((a, b) => Buffer.compare(Buffer.from(id(a), "utf8"), Buffer.from(id(b), "utf8")));
    }
    
    /** Order on the wire does not matter: the lists are hashed sorted by id, byte-wise. */
    static recipientsHash(recipients: Recipients): Buffer {
        const writer = new ByteWriter().tag("pmx-space-recipients").u32(recipients.groups.length);
        for (const g of SpaceStatement.sorted(recipients.groups, x => x.groupId)) {
            writer.lp(g.groupId).lp(g.role).u64(g.groupKeyVersion).lp(g.groupPubKey);
        }
        writer.u32(recipients.users.length);
        for (const u of SpaceStatement.sorted(recipients.users, x => x.userId)) {
            writer.lp(u.userId).lp(u.pubKey).lp(u.role);
        }
        return Crypto.sha256(writer.bytes());
    }
    
    /** The bytes the author signs (the signature is over their SHA-256). */
    static signedBytes(st: Omit<types.cloud.SpaceStatement, "signature"|"viaSignature">): Buffer {
        const prevDigest = Buffer.from(st.prevDigest, "hex");
        return new ByteWriter()
            .tag("pmx-space-statement")
            .u8(1)
            .lp(st.spaceId)
            .lp(st.contextId)
            .u64(st.seq)
            .u32(prevDigest.length)
            .raw(prevDigest)
            .u8(SpaceStatement.OP_CODES[st.op])
            .u64(st.date)
            .u64(st.keyVersion)
            .raw(Buffer.from(st.keyCommit, "hex"))
            .raw(SpaceStatement.recipientsHash(st))
            .lp(st.signer)
            .lp(st.signerPubKey)
            .lp(st.via)
            .bytes();
    }
    
    /** What a member of the group `via` signs with the group's own key: this statement, and nothing else. */
    static viaBytes(st: Omit<types.cloud.SpaceStatement, "signature"|"viaSignature">): Buffer {
        return new ByteWriter().tag("pmx-space-via").raw(Crypto.sha256(SpaceStatement.signedBytes(st))).bytes();
    }
    
    /** Identity of a statement as signed - what the next one names as `prevDigest`. Hex. */
    static digest(st: types.cloud.SpaceStatement): string {
        return Crypto.sha256(Buffer.concat([
            SpaceStatement.signedBytes(st), Buffer.from(st.signature, "base64"), Buffer.from(st.viaSignature, "base64"),
        ])).toString("hex");
    }
    
    /** The header byte is held to what the native Endpoint verifies, as for a group's statement. */
    private static verify(pubKey: string, signature: string, bytes: Buffer): boolean {
        try {
            const header = Buffer.from(signature, "base64")[0];
            return header >= 27 && header <= 42 && ECUtils.verifySignature2(pubKey as types.core.EccPubKey, signature as types.core.EccSignature, Crypto.sha256(bytes));
        }
        catch {
            return false;
        }
    }
    
    /** Against the key the statement names itself; that it is the caller's key is checked beside this. */
    static verifySignature(st: types.cloud.SpaceStatement): boolean {
        return SpaceStatement.verify(st.signerPubKey, st.signature, SpaceStatement.signedBytes(st));
    }
    
    static verifyViaSignature(st: types.cloud.SpaceStatement, groupPubKey: types.cloud.GroupPubKey): boolean {
        return SpaceStatement.verify(groupPubKey, st.viaSignature, SpaceStatement.viaBytes(st));
    }
    
    /** The same recipients, each with the same role, key and group epoch, in any order. */
    static sameRecipients(a: Recipients, b: Recipients): boolean {
        const ids = (r: Recipients) => new Set([...r.groups.map(g => "g:" + g.groupId), ...r.users.map(u => "u:" + u.userId)]).size;
        return ids(a) === a.groups.length + a.users.length && SpaceStatement.recipientsHash(a).equals(SpaceStatement.recipientsHash(b));
    }
}
