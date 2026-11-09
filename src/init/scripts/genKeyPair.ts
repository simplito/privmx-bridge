/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import { ECUtils } from "../../utils/crypto/ECUtils";
import { secp256k1ToBase58 } from "../../utils/crypto/VerifyKey";

const keyPair = ECUtils.generateKeyPair();
console.log(`PRIV_WIF=${keyPair.privWif}`);
// Both forms, because this script has no single consumer: the API refuses an untagged key, while the
// PKI keystore paths are secp256k1 by construction and carry no tag.
console.log(`PUB_58=${secp256k1ToBase58(keyPair.keyPair)}`);
console.log(`PUB_58_UNTAGGED=${keyPair.pub58}`);
