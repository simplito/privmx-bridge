/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DateUtils } from "../../utils/DateUtils";
import * as types from "../../types";
import { Callbacks } from "../../service/event/Callbacks";
import { Logger } from "../../service/log/LoggerFactory";

export interface Config {
    cloudUrl?: string;
    server: {
        port: number;
        unixSocket: string;
        hostname: string;
        workers: number;
        mainPageRedirect: string;
        mode: SingleServerMode;
        logStats: boolean;
        shutdownTimeout: types.core.Timespan;
        ssl: {
            enabled: boolean;
            port: number;
            privKeyPath: string;
            certificatePath: string;
        };
        url: {
            baseUrl: string;
            useBaseUrl: boolean;
        };
        initializationToken: string|null;
    };
    db: {
        mongo: {
            url: string;
        };
        storageProviderName: string;
        randomWriteStorageProviderName: string;
    };
    metrics: {
        enabled: boolean;
        username: string;
        password: string;
    }
    request: {
        chunkSize: number;
    };
    loggerEscapeNewLine: boolean;
    apiRateLimit: {
        enabled: boolean;
        initialCredit: number;
        maxCredit: number;
        creditAddon: number;
        addonInterval: number;
        requestCost: number;
        inactiveTime: number;
        whitelist: types.core.IPAddress[];
    };
    maximumChannelsPerSession: number,
}

export interface SingleServerMode {
    type: "single";
    configPath: string;
}

export type HostId = types.core.Host | (string&{__hostId: never});

export function loadConfig(logger: Logger|false, callbacks?: Callbacks) {
    const configFilePath = process.argv[2] || path.join(__dirname, "../../../conf/config.json");
    const configFromFile: Partial<Config> = (() => {
        if (configFilePath && fs.existsSync(configFilePath)) {
            if (logger) {
                logger.out(`Loading config from file ${configFilePath}`);
            }
            return JSON.parse(fs.readFileSync(configFilePath, "utf8"));
        }
        if (logger) {
            logger.out("No config file found");
        }
        return {};
    })();
    return loadConfigCore(configFilePath, configFromFile, logger, callbacks);
}

export function loadConfigFromFile(configFilePath: string, logger: Logger|false, callbacks?: Callbacks) {
    const configFromFile: Partial<Config> = JSON.parse(fs.readFileSync(configFilePath, "utf8"));
    return loadConfigCore(configFilePath, configFromFile, logger, callbacks);
}

export function loadConfigCore(configFilePath: string, configFromFile: Partial<Config>, logger: Logger|false, callbacks?: Callbacks) {
    const defaultConfig: Config = {
        cloudUrl: undefined,
        server: {
            port: parseInt(process.env.PRIVMX_PORT || "", 10) || 3000,
            unixSocket: path.resolve(__dirname, "../../../unix.sock"),
            hostname: process.env.PRIVMX_HOSTNAME || "0.0.0.0",
            workers: parseInt(process.env.PRIVMX_WORKERS || "", 10) || os.cpus().length,
            mainPageRedirect: process.env.PRIVMX_MAIN_PAGE_REDIRECT || "",
            mode: {
                type: "single",
                configPath: configFilePath,
            },
            logStats: process.env.PRIVMX_LOG_STATS !== "true",
            shutdownTimeout: parseInt(process.env.PRIVMX_SHUTDOWN_TIMEOUT || "", 10) as types.core.Timespan || DateUtils.seconds(5),
            ssl: {
                enabled: process.env.PRIVMX_SSL_ENABLED === "true" || false,
                port: parseInt(process.env.PRIVMX_SSL_PORT || "", 10) || 3443,
                privKeyPath: process.env.PRIVMX_SSL_PRIV_KEY_PATH || "privkey.pem",
                certificatePath: process.env.PRIVMX_SSL_CERT_PATH || "cert.pem",
            },
            url: {
                baseUrl: process.env.PRIVMX_BASE_URL || "http://localhost",
                useBaseUrl: process.env.PRIVMX_USE_BASE_URL === "true",
            },
            initializationToken: process.env.PRIVMX_INITIALIZATION_TOKEN || null,
        },
        db: {
            mongo: {
                url: process.env.PRIVMX_MONGO_URL || "mongodb://localhost:27017/",
            },
            storageProviderName: process.env.PRIVMX_STORAGE_PROVIDER_NAME || "fs",
            randomWriteStorageProviderName: process.env.PRIVMX_RANDOM_WRITE_STORAGE_PROVIDER_NAME || "fs",
        },
        metrics: {
            enabled: process.env.PRIVMX_METRICS_ENABLED === "true",
            username: process.env.PRIVMX_METRICS_USER || "admin",
            password: process.env.PRIVMX_METRICS_PASSWORD || "password",
        },
        request: {
            chunkSize: parseInt(process.env.PRIVMX_REQUEST_CHUNK_SIZE || "", 10) || 5 * 1024 * 1024,
        },
        loggerEscapeNewLine: process.env.PRIVMX_LOGGER_ESCAPE_NEW_LINE === "false" ? false : true,
        apiRateLimit: {
            enabled: process.env.PMX_LIMITER_ENABLED === "true",
            initialCredit: parseInt(process.env.PMX_LIMITER_INITIAL_CREDIT || "", 10) || 1000,
            maxCredit: parseInt(process.env.PMX_LIMITER_MAX_CREDIT || "", 10) || 1200,
            creditAddon: parseInt(process.env.PMX_LIMITER_CREDIT_ADDON || "", 10) || 100,
            addonInterval: parseInt(process.env.PMX_LIMITER_CREDIT_ADDON_INTERVAL || "", 10) || 1000,
            requestCost: parseInt(process.env.PMX_LIMITER_REQUEST_COST || "", 10) || 10,
            inactiveTime: parseInt(process.env.PMX_LIMITER_INACTIVE_TIME || "", 10) ||  2 * 60 * 1000,
            whitelist: process.env.PMX_LIMITER_WHITELIST ? process.env.PMX_LIMITER_WHITELIST.split(",") as types.core.IPAddress[] : [],
        },
        maximumChannelsPerSession: parseInt(process.env.PMX_MAX_CHANNELS_PER_SESSION || "", 10) || 128,
    };
    if (callbacks) {
        callbacks.triggerSync("applyDefaultConfig", [defaultConfig]);
    }
    const config = mergeValues(defaultConfig, configFromFile);
    if (logger) {
        logger.out("Config loaded", config);
    }
    return config;
}

function mergeValues<T>(a: T, b: Partial<T>) {
    if (typeof(a) != "object" || a == null || Array.isArray(b)) {
        return b as T;
    }
    const res: any = {...a};
    for (const x in b) {
        if (x in a || x === "configDirectory" || x === "dbName") {
            res[x] = x in res ? mergeValues(a[x] as Record<string, unknown>, b[x] as Record<string, unknown>) : b[x];
        }
        if (x === "configTemplate") {
            res[x] = b[x];
        }
    }
    return res as T;
}
