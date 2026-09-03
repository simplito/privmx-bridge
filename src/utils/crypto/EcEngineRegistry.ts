/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type { EcEngine } from "./EcEngine";
import { NobleEcEngine } from "./NobleEcEngine";

let activeEngine: EcEngine = new NobleEcEngine();

/** Install the active secp256k1 engine (e.g. privmx-native acceleration, or an alternative library). */
export function setEcEngine(engine: EcEngine): void {
    activeEngine = engine;
}

/** The active secp256k1 engine. Defaults to the pure-JS noble engine. */
export function getEcEngine(): EcEngine {
    return activeEngine;
}
