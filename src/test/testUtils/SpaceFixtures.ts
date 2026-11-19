/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as elliptic from "elliptic";
import * as types from "../../types";
import { Crypto } from "../../utils/crypto/Crypto";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { SpaceStatement } from "../../service/cloud/SpaceStatement";

export type UnsignedSpaceStatement = Omit<types.cloud.SpaceStatement, "signature"|"viaSignature">;

/**
 * Signs a space statement the way the endpoint does: the author's compact ECDSA over SHA-256 of the signed
 * bytes and, when the author acts through a group (`via`), the group's key over the via bytes.
 */
export function signSpaceStatement(unsigned: UnsignedSpaceStatement, signer: elliptic.ec.KeyPair, viaKey?: elliptic.ec.KeyPair): types.cloud.SpaceStatement {
    const sign = (key: elliptic.ec.KeyPair, bytes: Buffer) => ECUtils.signToCompactSignature(key, Crypto.sha256(bytes)).toString("base64") as types.core.Base64;
    return {
        ...unsigned,
        signature: sign(signer, SpaceStatement.signedBytes(unsigned)),
        viaSignature: viaKey ? sign(viaKey, SpaceStatement.viaBytes(unsigned)) : "",
    };
}
