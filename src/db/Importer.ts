/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../service/log/LoggerFactory";
import { FsPromise } from "../utils/FsPromise";
import * as fs from "fs";
import * as path from "path";
import * as mkdrip from "mkdirp";
import { Crypto } from "../utils/crypto/Crypto";
import { MongoDbManager } from "./mongo/MongoDbManager";
import { IStorageService, FileId } from "../service/misc/StorageService";
import * as mongodb from "mongodb";
export class Importer {
    
    constructor(
        private mongoDbManager: MongoDbManager,
        private logger: Logger,
        private storageService: IStorageService,
    ) {
    }
    
    async import(dir: string) {
        await this.storageService.clearStorage(); // start with clearing storage because some implementaion can hold information in mongodb
        await this.importMongo(path.resolve(dir, "mongo"));
        await this.importStorageFiles(path.resolve(dir, "storage"));
    }
    
    async importMongo(dir: string) {
        const db = this.mongoDbManager.getDb();
        await db.dropDatabase();
        const files = await FsPromise.readdir(dir);
        const indexes: Record<string, string[]> = {
            calendarMessage: ["calendarId", "seq"],
            deviceToken: ["sessionId"],
            sink: ["cachedAccess"],
            kvdb: ["cachedAccess"],
            descriptorGroup: ["cachedAccess"],
            section: ["cachedReadAccess", "cachedManageAccess"],
        };
        for (const [i, file] of files.entries()) {
            const filePath = path.resolve(dir, file);
            const collectionName = file.replace(".json", "");
            const collection = await db.createCollection(collectionName);
            if (collectionName.startsWith("kvdbentry-")) {
                await collection.createIndex("seq");
            }
            else if (collectionName.startsWith("msg-")) {
                await collection.createIndex("modSeq");
            }
            for (const index of indexes[collectionName] || []) {
                await collection.createIndex(index);
            }
            const dbData = JSON.parse(await FsPromise.readFileEnc(filePath, "utf8")) as mongodb.Document[];
            this.logger.notice("Importing " + ((i + 1) + "/" + files.length) + " " + file + " " + dbData.length);
            for (const entry of dbData) {
                await collection.insertOne(entry);
            }
        }
        const serverDataId = Crypto.randomBytes(16).toString("hex");
        await db.collection<{_id: string}>("settings").updateOne({_id: "serverDataId"}, {$set: {value: serverDataId}}, {upsert: true});
        await this.mongoDbManager.ensureLockCollection();
    }
    
    async importStorageFiles(srcDir: string) {
        await this.storageService.switchToFreshStorage();
        const files = await fs.promises.readdir(srcDir);
        for (const [i, fileName] of files.entries()) {
            const parsed = this.parseFileName(fileName);
            if (parsed !== false && parsed.type === "data") {
                const fileId = parsed.id;
                this.logger.notice(`Copying from storage ${i + 1}/${files.length} ${fileId}`);
                const data = await fs.promises.readFile(path.resolve(srcDir, `storage-${fileId}-data`));
                const checksum = await fs.promises.readFile(path.resolve(srcDir, `storage-${fileId}-checksum`));
                await this.storageService.create(fileId);
                await this.storageService.append(fileId, data, 0);
                await this.storageService.setChecksumAndClose(fileId, checksum, 1);
            }
        }
    }
    
    async export(dir: string) {
        await this.exportMongo(path.resolve(dir, "mongo"));
        await this.exportStorageFiles(path.resolve(dir, "storage"));
    }
    
    async exportMongo(dir: string) {
        await mkdrip(dir);
        const db = this.mongoDbManager.getDb();
        let collections: {name: string, type?: string}[] = await db.listCollections().toArray();
        collections = collections.filter(x => x.type == "collection");
        for (const [i, col] of collections.entries()) {
            this.logger.notice("Exporting " + ((i + 1) + "/" + collections.length) + " " + col.name);
            const filePath = path.resolve(dir, col.name + ".json");
            const data = await db.collection(col.name).find({}).toArray();
            await FsPromise.writeFileEnc(filePath, JSON.stringify(data), "utf8");
        }
    }
    
    async exportStorageFiles(exportDir: string) {
        await fs.promises.mkdir(exportDir, {recursive: true});
        const list = await this.storageService.list();
        for (const [i, fileId] of list.entries()) {
            this.logger.notice(`Copying from storage ${i + 1}/${list.length} ${fileId}`);
            const data = await this.storageService.read(fileId, {type: "all"});
            const checksum = await this.storageService.read(fileId, {type: "checksum"});
            await fs.promises.writeFile(path.resolve(exportDir, `storage-${fileId}-data`), data);
            await fs.promises.writeFile(path.resolve(exportDir, `storage-${fileId}-checksum`), checksum);
        }
    }
    
    private parseFileName(fileName: string): {id: FileId, type: "data"|"checksum"}|false {
        const splitted = fileName.split("-");
        if (splitted.length === 3) {
            const [prefix, id, type] = splitted;
            if (prefix === "storage" && (type === "data" || type === "checksum")) {
                return {id: id as FileId, type: type};
            }
        }
        return false;
    }
}
