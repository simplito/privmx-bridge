/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { DbManager } from "../../db/DbManager";
import { Logger } from "../../service/log/LoggerFactory";
import { ObjectRepositoryFactory } from "../../db/ObjectRepository";
import * as types from "../../types";
import { IOC } from "../../service/ioc/IOC";
import { DateUtils } from "../../utils/DateUtils";
import * as mongodb from "mongodb";
import { Crypto } from "../../utils/crypto/Crypto";
import { Migration000Scheme } from "./Migration000Scheme";
import { Migration049AddCloudCollections } from "./Migration049AddCloudCollections";
import { Migration050AddTypeToCloudResources } from "./Migration050AddTypeToCloudResources";
import { Migration051AddAclToContextUser } from "./Migration051AddAclToContextUser";
import { Migration052ThreadTypes } from "./Migration052ThreadTypes";
import { Migration053AddIndexes } from "./Migration053AddIndexes";
import { Migration053StoreTypes } from "./Migration053StoreTypes";
import { Migration054Auth } from "./Migration054Auth";
import { Migration055Context } from "./Migration055Context";
import { Migration056Solution } from "./Migration056Solution";
import { Migration057RenameThreadCollection } from "./Migration057RenameThreadCollection";
import { Migration058FileUpdates } from "./Migration058FileUpdates";
import { Migration059ApiKeyScopes } from "./Migration059ApiKeyScopes";
import { Migration060IndexesForSortableFields } from "./Migration060IndexesForSortableFields";
import { Migration061IndexesForAuthorField } from "./Migration061IndexesForAuthorField";
import { Migration062IndexesForCreateDate } from "./Migration062IndexesForCreateDate";

export type MigrationId = string&{__migrationId: never};

export type MigrationStatus = "PERFORMING"|"FAIL"|"SUCCESS";

export interface MigrationModel {
    id: MigrationId;
    startDate: types.core.Timestamp;
    endDate: types.core.Timestamp|null;
    status: MigrationStatus;
}

export interface Migration {
    id: MigrationId;
    transaction?: boolean;
    go: (ioc: IOC, session: mongodb.ClientSession|undefined) => Promise<void>;
}

export class MigrationManager {
    
    private migrationRepositoryFactory: ObjectRepositoryFactory<MigrationId, MigrationModel>;
    private static MIGRATIONS: Migration[] = [
        Migration000Scheme,
        Migration049AddCloudCollections,
        Migration050AddTypeToCloudResources,
        Migration051AddAclToContextUser,
        Migration052ThreadTypes,
        Migration053AddIndexes,
        Migration053StoreTypes,
        Migration054Auth,
        Migration055Context,
        Migration056Solution,
        Migration057RenameThreadCollection,
        Migration058FileUpdates,
        Migration059ApiKeyScopes,
        Migration060IndexesForSortableFields,
        Migration061IndexesForAuthorField,
        Migration062IndexesForCreateDate
    ];
    static DB_VERSION: string|null = null;
    
    constructor(
        private dbManager: DbManager,
        private ioc: IOC,
        private logger: Logger,
    ) {
        this.migrationRepositoryFactory = this.dbManager.createObjectRepositoryFactory("migration", "id");
    }
    
    static getDbVersion() {
        if (!MigrationManager.DB_VERSION) {
            const str = MigrationManager.MIGRATIONS.map(x => x.id).join(",");
            MigrationManager.DB_VERSION = Crypto.sha1(Buffer.from(str, "utf8")).toString("hex");
        }
        return MigrationManager.DB_VERSION;
    }
    
    go() {
        this.logger.debug("Starting migration process...");
        return this.migrationRepositoryFactory.withRepositoryWrite(async repo => {
            const migrationModels = await repo.getAll();
            if (migrationModels.find(x => x.status != "SUCCESS")) {
                this.logger.error("Old migrations not finished with success. Repair db state manually");
                throw new Error("Old migrations not finished with success. Repair db state manually");
            }
            const dbMigrationId = process.env.PMX_MIGRATION;
            for (const migration of MigrationManager.MIGRATIONS) {
                let model = migrationModels.find(x => x.id == migration.id);
                if (model) {
                    this.logger.debug("Migration '" + migration.id + "' already done!");
                    continue;
                }
                this.logger.debug("Performing '" + migration.id + "' migration...");
                model = {
                    id: migration.id,
                    startDate: DateUtils.now(),
                    endDate: null,
                    status: "PERFORMING"
                };
                await repo.insert(model);
                try {
                    if (migration.transaction === false) {
                        await migration.go(this.ioc, undefined);
                    }
                    else {
                        await this.ioc.getMongoDbManager().withTransaction(session => migration.go(this.ioc, session));
                    }
                    model.endDate = DateUtils.now();
                    model.status = "SUCCESS";
                    await repo.update(model);
                    this.logger.debug("Migration '" + migration.id + "' successfully finished!");
                }
                catch (e) {
                    this.logger.error("Error during performing migration '" + migration.id + "'", e);
                    model.endDate = DateUtils.now();
                    model.status = "FAIL";
                    await repo.update(model);
                    this.logger.error("Migration process fails!");
                    throw new Error("Migration process fails!");
                }
                if (migration.id === dbMigrationId) {
                    break;
                }
            }
            this.logger.debug("Migration process finished with success!");
        });
    }
}
