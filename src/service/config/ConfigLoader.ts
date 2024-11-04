/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as fs from "fs";
import * as NodePath from "path";
import * as types from "../../types";
import { Callbacks } from "../event/Callbacks";
import { DateUtils } from "../../utils/DateUtils";
import { DeepPartial } from "../../CommonTypes";
import { VersionDetector } from "./VersionDetector";

export type ConfigLoaderFunc = () => ConfigValues;

export interface ConfigValues {
    running?: boolean;
    domain: string;
    hosts: types.core.Host[];
    baseDir: string;
    assetsDir: string;
    server: {
        version: types.core.Version;
        staticDirs: {url: string, path: string}[];
        fallbackHtml: string;
        compressedPaths: string[];
        cors: {
            enabled: boolean;
            domains: types.core.Host[];
            cacheTTL: types.core.Timespan;
        };
        proxy: {
            allowedRemotes: string | string[];
            allowedHeaders: (string | [string, {[key: string]: unknown;}])[];
        };
    };
    application: {
        allowUnauthorized: boolean;
        maxTimeDiff: types.core.Timespan;
        allowed: {
            appId: string;
            appSeret: string;
        }[];
    };
    db: {
        mongo: {
            url: string;
            dbName: string;
        };
        storageProviderName: string;
    };
    request: {
        chunkSize: number;
        maxFilesCount: number;
        maxRequestSize: number;
        maxFileSize: number;
        clearInterval: types.core.Timespan;
        maxInactiveTime: types.core.Timespan;
        tmpDir: string;
        filesDir: string;
    };
    misc: {
        maxTimestampDifference: types.core.Timespan;
        dumpDepsDir: string;
    };
    user: {
        allowedUsernames: string[];
        session: {
            ticketsTTL: types.core.Timespan;
            exchangeTimeout: types.core.Timespan;
            restorableSessionTTL: types.core.Timespan;
        };
    };
    proxy: {
        serverSessionTTL: types.core.Timespan;
    };
    token: {
        cipherKeyTTL: types.core.Timespan;
        accessTokenLifetime: types.core.Timespan;
        refreshTokenLifetime: types.core.Timespan;
    };
}

export type InitConfigValues = DeepPartial<ConfigValues>;
export type ConfigChanger = (values: ConfigValues) => ConfigValues;

export class ConfigLoader {
    
    constructor(
        private callbacks: Callbacks
    ) {
    }
    
    getDefaultValues() {
        const baseDir = VersionDetector.detectBaseDir();
        const values: ConfigValues = {
            domain: "localhost",
            hosts: undefined,
            baseDir: baseDir,
            assetsDir: NodePath.resolve(baseDir, "public"),
            server: {
                version: VersionDetector.detectServerVersion(),
                staticDirs: [],
                fallbackHtml: undefined,
                compressedPaths: [],
                cors: process.env.PRIVMX_CORS_ENABLED === "true" ? {
                    enabled: true,
                    domains: ["*"] as types.core.Host[],
                    cacheTTL: DateUtils.minutes(10),
                } : {
                    enabled: false,
                    domains: [],
                    cacheTTL: DateUtils.minutes(10),
                },
                proxy: {
                    allowedRemotes: "loopback",
                    allowedHeaders: ["forwarded-for"]
                },
            },
            application: {
                allowUnauthorized: true,
                maxTimeDiff: DateUtils.minutes(5),
                allowed: [],
            },
            db: {
                mongo: {
                    url: "mongodb://localhost:27017",
                    dbName: undefined
                },
                storageProviderName: "fs",
            },
            request: {
                chunkSize: 5 * 1024 * 1024,
                maxFilesCount: 100,
                maxRequestSize: 1000 * 1000 * 1000 * 7,
                maxFileSize: 1000 * 1000 * 1000 * 5,
                clearInterval: DateUtils.minutes(10),
                maxInactiveTime: DateUtils.minutes(10),
                tmpDir: NodePath.join(baseDir, "storage/tmp"),
                filesDir: NodePath.join(baseDir, "storage/files")
            },
            misc: {
                maxTimestampDifference: DateUtils.hours(1),
                dumpDepsDir: null,
            },
            user: {
                allowedUsernames: [],
                session: {
                    ticketsTTL: DateUtils.minutes(15),
                    restorableSessionTTL: DateUtils.days(5),
                    exchangeTimeout: DateUtils.minutes(2)
                },
            },
            proxy: {
                serverSessionTTL: DateUtils.hours(2),
            },
            token: {
                cipherKeyTTL: DateUtils.hours(1),
                accessTokenLifetime: DateUtils.minutes(15),
                refreshTokenLifetime: DateUtils.days(7),
            },
        };
        this.callbacks.triggerSync("applyDefaultConfig", [values]);
        return values;
    }
    
    applyConfigFile(values: ConfigValues, configPath: string) {
        try {
            if (fs.existsSync(configPath)) {
                // this.logger.debug("Reading config file '" + configPath + "'");
                const cfgContent = fs.readFileSync(configPath, "utf8");
                const cfg = JSON.parse(cfgContent);
                if (typeof(cfg) != "object" || cfg == null) {
                    throw new Error("Config expected to be an object");
                }
                values = ConfigLoader.overwriteOptions(values, cfg);
            }
            else {
                // this.logger.debug("No config file");
            }
            return values;
        }
        catch (e) {
            // this.logger.error("Cannot read config file " + configPath, e);
            throw e;
        }
    }
    
    finishConfigLoad(values: ConfigValues) {
        if (values.hosts == undefined) {
            values.hosts = [<types.core.Host>values.domain];
        }
        if (values.db.mongo.dbName == undefined) {
            values.db.mongo.dbName = "privmx_" + values.domain.replace(/\./g, "_");
        }
        this.callbacks.triggerSync("finishConfigLoad", [values]);
        // this.logger.debug("Current config", JSON.stringify(values, null, 2));
        return values;
    }
    
    static overwriteOptions<T = any>(target: T, source: T): T {
        if (typeof(target) != "object" || target == null) {
            return source;
        }
        if (typeof(source) != "object") {
            throw new Error("Cannot overwrite object with primitive type");
        }
        if (Array.isArray(target)) {
            if (!Array.isArray(source)) {
                throw new Error("Cannot mix array with object");
            }
            return source;
        }
        for (const key in source) {
            try {
                target[key] = this.overwriteOptions(target[key], source[key]);
            }
            catch (e: any) {
                throw new Error("OverwriteOptions " + key + ": " + (e && e.message ? e.message : ""));
            }
        }
        return target;
    }
    
    getFileLoader(configPath: string): ConfigLoaderFunc {
        return () => {
            const loader = new ConfigLoader(this.callbacks);
            let values = loader.getDefaultValues();
            values = loader.applyConfigFile(values, configPath);
            values = loader.finishConfigLoad(values);
            return values;
        };
    }
    
    getConfigChangerLoader(configChanger: ConfigChanger, finisher: ConfigChanger): ConfigLoaderFunc {
        return () => {
            // logMicro("getConfigChangerLoader 01");
            const loader = new ConfigLoader(this.callbacks);
            // logMicro("getConfigChangerLoader 02");
            let values = loader.getDefaultValues();
            // logMicro("getConfigChangerLoader 03");
            values = configChanger(values);
            // logMicro("getConfigChangerLoader 04");
            values = loader.finishConfigLoad(values);
            // logMicro("getConfigChangerLoader 05");
            values = finisher(values);
            return values;
        };
    }
}
