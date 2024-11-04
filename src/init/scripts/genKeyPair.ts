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

const keyPair = ECUtils.generateKeyPair();
console.log(`PRIV_WIF=${keyPair.privWif}`);
console.log(`PUB_58=${keyPair.pub58}`);
