/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as mongodb from "mongodb";

export type LangSetting<T> = {langs: {[lang: string]: T}, defaultLang: string};

export class SettingsService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    // ====================
    //      COMMON
    // ====================
    
    hasSetting(name: string): Promise<boolean> {
        const repo = this.repositoryFactory.createSettingsRepository();
        return repo.exists(name);
    }
    
    deleteSetting(name: string): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(`setting-${name}`, session => {
            const repo = this.repositoryFactory.createSettingsRepository(session);
            return repo.delete(name);
        });
    }
    
    // ====================
    //      STRINGS
    // ====================
    
    async getString<T extends string = string>(name: string): Promise<T|null> {
        const repo = this.repositoryFactory.createSettingsRepository();
        const entry = await repo.get(name);
        return entry ? <T>entry.value : null;
    }
    
    async getStrings<T = {[key: string]: string|null}>(names: string[]): Promise<T> {
        const repo = this.repositoryFactory.createSettingsRepository();
        const values: {[key: string]: string|null} = {};
        const entries = await repo.getMulti(names);
        for (const name of names) {
            const entry = entries.find(x => x.id == name);
            values[name] = entry ? entry.value : null;
        }
        return <T><any>values;
    }
    
    setString(name: string, value: string): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(`setting-${name}`, session => {
            return this.setStringSession(session, name, value);
        });
    }
    
    async setStringSession(session: mongodb.ClientSession, name: string, value: string): Promise<void> {
        const repo = this.repositoryFactory.createSettingsRepository(session);
        return repo.update({id: name, value: value});
    }
    
    setStrings(settings: {[key: string]: string}): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(Object.keys(settings).map(x => `setting-${x}`), async session => {
            return this.setStringsSession(session, settings);
        });
    }
    
    async setStringsSession(session: mongodb.ClientSession, settings: {[key: string]: string}): Promise<void> {
        const repo = this.repositoryFactory.createSettingsRepository(session);
        for (const name in settings) {
            await repo.update({id: name, value: settings[name]});
        }
    }
    
    updateString(name: string, func: (value: string|null) => string|false): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(`setting-${name}`, async session => {
            return this.updateStringSession(session, name, func);
        });
    }
    
    async updateStringSession(session: mongodb.ClientSession, name: string, func: (value: string|null) => string|false): Promise<void> {
        const repo = this.repositoryFactory.createSettingsRepository(session);
        const entry = await repo.get(name);
        const res = func(entry ? entry.value : null);
        if (res !== false) {
            await repo.update({id: name, value: res});
        }
    }
    
    // ====================
    //      NUMBER
    // ====================
    
    async getNumber<T extends number = number>(name: string): Promise<T|null> {
        const repo = this.repositoryFactory.createSettingsRepository();
        const entry = await repo.get(name);
        return entry ? <T>parseFloat(entry.value) : null;
    }
    
    setNumber<T extends number = number>(name: string, value: T): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(`setting-${name}`, session => {
            return this.setNumberSession(session, name, value);
        });
    }
    
    setNumberSession<T extends number = number>(session: mongodb.ClientSession, name: string, value: T): Promise<void> {
        const repo = this.repositoryFactory.createSettingsRepository(session);
        return repo.update({id: name, value: "" + value});
    }
    
    // ====================
    //      OBJECT
    // ====================
    
    async getObject<T = unknown>(name: string): Promise<T|null> {
        const repo = this.repositoryFactory.createSettingsRepository();
        const entry = await repo.get(name);
        return entry ? JSON.parse(entry.value) : null;
    }
    
    setObject<T = any>(name: string, value: T): Promise<void> {
        return this.repositoryFactory.withTransactionAndLock(`setting-${name}`, session => {
            return this.setObjectSession(session, name, value);
        });
    }
    
    setObjectSession<T = any>(session: mongodb.ClientSession, name: string, value: T): Promise<void> {
        const repo = this.repositoryFactory.createSettingsRepository(session);
        return repo.update({id: name, value: JSON.stringify(value)});
    }
    
    // ====================
    //      LANGUAGE
    // ====================
    
    async getSettingWithDefaultLanguage<T = any>(name: string, defaultValue: T): Promise<T> {
        const setting = await this.getObject<LangSetting<T>>(name);
        if (setting == null) {
            return defaultValue;
        }
        if (setting.langs == null) {
            return defaultValue;
        }
        if (setting.defaultLang) {
            return setting.langs[setting.defaultLang] ? setting.langs[setting.defaultLang] : defaultValue;
        }
        const langs = Object.keys(setting.langs);
        return langs.length > 0 ? setting.langs[langs[0]] : defaultValue;
    }
    
    async getSettingForLanguage<T = any>(name: string, obj: {language: string}, defaultValue: T): Promise<T> {
        const setting = await this.getObject<LangSetting<T>>(name);
        if (setting == null) {
            return defaultValue;
        }
        if (setting.langs == null) {
            return defaultValue;
        }
        if (obj.language && setting.langs[obj.language]) {
            return setting.langs[obj.language];
        }
        if (setting.defaultLang == null) {
            return defaultValue;
        }
        return setting.langs[setting.defaultLang] ? setting.langs[setting.defaultLang] : defaultValue;
    }
    
    getSettingForLanguageFromObj<T = any>(setting: LangSetting<T>, lang: string): T {
        if (setting.langs[lang]) {
            return setting.langs[lang];
        }
        return setting.langs[setting.defaultLang];
    }
}
