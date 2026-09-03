/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*
 * Library-agnostic secp256k1 layer (see EC_LIBRARY_AGNOSTIC_PLAN.md). This module is the
 * stable entry point; the implementation is split across one class per file so callers keep
 * importing from a single place:
 *
 *   - `EcEngine` (./EcEngine) is the swappable port: bytes in, bytes out — no bn.js and no
 *     library objects cross it, so the backing library is replaceable in one place.
 *   - `NobleEcEngine` (./NobleEcEngine) is the default adapter (the ONLY code that imports
 *     @noble/curves).
 *   - `setEcEngine`/`getEcEngine` (./EcEngineRegistry) install/read the active engine
 *     (privmx-native registers an accelerated engine via PrivMXNative.init; a future library
 *     is one more adapter).
 *   - `EccKeyPair` / `EccPoint` (./EccKeyPair, ./EccPoint) are the engine-neutral value types
 *     the rest of the codebase passes around.
 *
 * Invariants every engine MUST preserve are documented on `EcEngine`
 * (see ELLIPTIC_TO_NOBLE_MIGRATION.md §3).
 */

export type { EccSignature, EcEngine, EllipticKeyLike } from "./EcEngine";
export { NobleEcEngine } from "./NobleEcEngine";
export { setEcEngine, getEcEngine } from "./EcEngineRegistry";
export { EccPoint } from "./EccPoint";
export { EccKeyPair, recoverPublicKey } from "./EccKeyPair";
