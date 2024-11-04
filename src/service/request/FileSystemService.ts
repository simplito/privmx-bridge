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
import { Logger } from "../log/LoggerFactory";
import * as types from "../../types";
import { ConfigService } from "../config/ConfigService";

export class FileSystemService {
    
    constructor(
        private configService: ConfigService,
        private logger: Logger,
    ) {
    }
    
    async moveFileFromTmpToStorage(id: types.request.FileId) {
        await this.moveFile(this.getTmpFilePath(id), this.getStorageFilePath(id));
        await this.moveFile(this.getTmpFileChecksumPath(id), this.getStorageFileChecksumPath(id));
    }
    
    async removeFileFromTmp(id: types.request.FileId) {
        await this.safelyRemoveFile(this.getTmpFilePath(id));
        await this.safelyRemoveFile(this.getTmpFileChecksumPath(id));
    }
    
    async removeFileFromStorage(id: types.request.FileId) {
        await this.safelyRemoveFile(this.getStorageFilePath(id));
        await this.safelyRemoveFile(this.getStorageFileChecksumPath(id));
    }
    
    async createTmpFile(id: types.request.FileId) {
        await this.createNewFile(this.getTmpFilePath(id));
    }
    
    async createTmpFileChecksum(id: types.request.FileId) {
        await this.createNewFile(this.getTmpFileChecksumPath(id));
    }
    
    async appendDataToTmpFile(id: types.request.FileId, data: Buffer) {
        await this.appendToExistingFile(this.getTmpFilePath(id), data);
    }
    
    async saveTmpFileChecksum(id: types.request.FileId, data: Buffer) {
        await this.writeToExistingFile(this.getTmpFileChecksumPath(id), data);
    }
    
    async createAndSaveFileChecksum(id: types.request.FileId, data: Buffer) {
        await this.createNewFileAndWrite(this.getStorageFileChecksumPath(id), data);
    }
    
    async list() {
        const files = await fs.promises.readdir(this.configService.values.request.filesDir);
        const list: types.request.FileId[] = [];
        for (const file of files) {
            if (!file.endsWith("-checksum")) {
                list.push(file as types.request.FileId);
            }
        }
        return list;
    }
    
    async clearStorage() {
        await fs.promises.rm(this.configService.values.request.tmpDir, {recursive: true, force: true});
        await fs.promises.rm(this.configService.values.request.filesDir, {recursive: true, force: true});
    }
    
    async readFromStorage(id: types.request.FileId, range: types.store.BufferReadRange) {
        if (range.type === "all") {
            const filePath = this.getStorageFilePath(id);
            return fs.promises.readFile(filePath);
        }
        if (range.type === "slice") {
            if (range.from < 0 || range.to < 0 || range.from >= range.to) {
                return Buffer.alloc(0);
            }
            const filePath = this.getStorageFilePath(id);
            const f = await fs.promises.open(filePath, "r");
            const stat = await f.stat();
            const from = Math.min(range.from, stat.size);
            const to = Math.min(range.to, stat.size);
            const length = to - from;
            const data = Buffer.alloc(length);
            await f.read(data, 0, length, range.from);
            await f.close();
            return data;
        }
        if (range.type === "checksum") {
            const filePath = this.getStorageFileChecksumPath(id);
            return fs.promises.readFile(filePath);
        }
        throw new Error("Unsupported range type");
    }
    
    async copyFile(srcId: types.request.FileId, dstId: types.request.FileId) {
        const srcPath = this.getStorageFilePath(srcId);
        const dstPath = this.getStorageFilePath(dstId);
        const srcChecksumPath = this.getStorageFileChecksumPath(srcId);
        const dstChecksumPath = this.getStorageFileChecksumPath(dstId);
        if (!fs.existsSync(srcPath) || !fs.existsSync(srcChecksumPath)) {
            throw new Error("File doesn't exist");
        }
        await fs.promises.link(srcPath, dstPath);
        await fs.promises.link(srcChecksumPath, dstChecksumPath);
    }
    
    getStorageDir() {
        return this.configService.values.request.filesDir;
    }
    
    private getTmpFilePath(id: types.request.FileId) {
        return path.join(this.configService.values.request.tmpDir, id);
    }
    
    private getStorageFilePath(id: types.request.FileId) {
        return path.join(this.configService.values.request.filesDir, id);
    }
    
    private getTmpFileChecksumPath(id: types.request.FileId) {
        return path.join(this.configService.values.request.tmpDir, id + "-checksum");
    }
    
    private getStorageFileChecksumPath(id: types.request.FileId) {
        return path.join(this.configService.values.request.filesDir, id + "-checksum");
    }
    
    private async createNewFile(filePath: string) {
        return this.createNewFileAndWrite(filePath, Buffer.alloc(0));
    }
    
    private async createNewFileAndWrite(filePath: string, buffer: Buffer) {
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        await fs.promises.writeFile(filePath, buffer, {flag: "wx"});
    }
    
    private async writeToExistingFile(filePath: string, data: Buffer) {
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        await fs.promises.writeFile(filePath, data);
    }
    
    private async appendToExistingFile(filePath: string, data: Buffer) {
        await fs.promises.appendFile(filePath, data);
    }
    
    private async moveFile(oldPath: string, newPath: string) {
        await fs.promises.mkdir(path.dirname(newPath), {recursive: true});
        await fs.promises.rename(oldPath, newPath);
    }
    
    private async safelyRemoveFile(filePath: string) {
        try {
            await this.removeFile(filePath);
        }
        catch (e) {
            if (e && (e as {code: string}).code === "ENOENT") {
                return;
            }
            this.logger.error("Error during removing file " + filePath, e);
        }
    }
    
    private async removeFile(filePath: string) {
        await fs.promises.unlink(filePath);
    }
    
    async readRepeatableSlicesFromStorage(id: types.request.FileId, range: {
        from: number;
        to: number;
        sliceSize: number;
        skipSize: number;
    }) {
        const filePath = this.getStorageFilePath(id);
        if (range.from < 0 || range.to < 0 || range.from >= range.to) {
            return Buffer.alloc(0);
        }
        if (range.sliceSize <= 0 || range.skipSize <= 0) {
            return Buffer.alloc(0);
        }
        const f = await fs.promises.open(filePath, "r");
        const stat = await f.stat();
        const from = Math.min(range.from, stat.size);
        const to = Math.min(range.to, stat.size);
        const data = Buffer.alloc(Math.ceil((to - from) / (range.sliceSize + range.skipSize)) * range.sliceSize);
        let pos = from;
        let bufPos = 0;
        while (true) {
            if (pos >= to) {
                break;
            }
            const length = pos + range.sliceSize > to ? to - pos : range.sliceSize;
            await f.read(data, bufPos, length, pos);
            bufPos += length;
            pos += length + range.skipSize;
        }
        await f.close();
        return data.slice(0, bufPos);
    }
}
