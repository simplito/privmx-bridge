/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { FileSystemService } from "../request/FileSystemService";
import { FileId, IStorageService, TmpFileId } from "./StorageService";

export class FileSystemStorageService implements IStorageService {
    
    constructor(
        private fileSystemService: FileSystemService,
    ) {
    }
    
    async read(id: FileId, range: types.store.BufferReadRange): Promise<Buffer> {
        return this.fileSystemService.readFromStorage(id, range);
    }
    
    async copy(src: FileId, dst: types.request.FileId): Promise<void> {
        return this.fileSystemService.copyFile(src, dst);
    }
    
    async delete(id: FileId): Promise<void> {
        return this.fileSystemService.removeFileFromStorage(id);
    }
    
    async create(id: TmpFileId): Promise<void> {
        await this.fileSystemService.createTmpFile(id);
        await this.fileSystemService.createTmpFileChecksum(id);
    }
    
    async append(id: TmpFileId, buffer: Buffer, _seq: number): Promise<void> {
        return this.fileSystemService.appendDataToTmpFile(id, buffer);
    }
    
    async setChecksumAndClose(id: TmpFileId, checksum: Buffer, _seqs: number): Promise<void> {
        return this.fileSystemService.saveTmpFileChecksum(id, checksum);
    }
    
    async commit(id: TmpFileId): Promise<void> {
        return this.fileSystemService.moveFileFromTmpToStorage(id);
    }
    
    async reject(id: TmpFileId, _seq: number): Promise<void> {
        return this.fileSystemService.removeFileFromTmp(id);
    }
    
    async list(): Promise<FileId[]> {
        return this.fileSystemService.list();
    }
    
    async clearStorage(): Promise<void> {
        return this.fileSystemService.clearStorage();
    }
    
    async switchToFreshStorage(): Promise<void> {
        /* Do nothing */
    }
}
