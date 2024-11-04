/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as pki from "privmx-pki2";
import { SettingsService } from "../misc/SettingsService";

export class PkiFactory {
    
    private static SERVER_KEYSTORE_SETTINGS_KEY = "serverKeystore";
    private keystorePromise?: Promise<pki.common.keystore.KeyStore>;
    
    constructor(
        private settingsService: SettingsService,
    ) {
    }
    
    getServerKeystoreFromSettings() {
        return this.settingsService.getString(PkiFactory.SERVER_KEYSTORE_SETTINGS_KEY);
    }
    
    setServerKeystoreInSettings(pem: string) {
        return this.settingsService.setString(PkiFactory.SERVER_KEYSTORE_SETTINGS_KEY, pem);
    }
    
    async loadKeystore() {
        if (this.keystorePromise == null) {
            this.keystorePromise = (async () => {
                const pem = await this.getServerKeystoreFromSettings();
                if (!pem) {
                    throw new Error("Missing server keystore");
                }
                return pki.common.keystore.KeyStore.deserialize(pki.common.keystore.Packet.unarmor(pem));
            })();
        }
        return this.keystorePromise;
    }
    
    registerKeystore(keystore: pki.common.keystore.KeyStore) {
        if (this.keystorePromise != null) {
            throw new Error("Server keystore already registered");
        }
        this.keystorePromise = Promise.resolve(keystore);
    }
}
