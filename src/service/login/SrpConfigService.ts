/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { SrpConfig } from "../../utils/crypto/SrpLogic";
import * as types from "../../types";
import { Hex } from "../../utils/Hex";

export class SrpConfigService {
    
    constructor(
        public config: SrpConfig,
    ) {
    }
    
    getInfo(): types.user.SrpInfo {
        return {
            N: Hex.fromBN(this.config.N),
            g: Hex.fromBN(this.config.g),
        };
    }
}
