/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "../../utils/crypto/Crypto";

it("Utils.findMin2", () => {
    const label = "key expansion";
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "binary"); // Crypto.randomBytes(32);
    const value1 = Crypto.simpleKdf64Sha256(key, label);
    const value2 = Crypto.kdf("sha256", 64, key, label);
    expect(value1.equals(value2)).toBeTruthy();
});