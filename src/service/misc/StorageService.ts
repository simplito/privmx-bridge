/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import type * as mongodb from "mongodb";

export type FileId = types.request.FileId;
export type TmpFileId = types.request.FileId;
export type RandomWriteStorageContext = Record<string, unknown>;
/**
    File has two states. When file is uploaded, firstly you create temporary file, append data to it, set checksum and
    in the end you commit that file or reject it. When it is committed you can read/copy/delete it. Copy operation
    do not create temporary file it creates normal file at once. File contains only data and checksum
*/
export interface IStorageService {
    /**
        Read file basing on range parameter, it can be: whole file (all), file checksum (checksum) or given slice (slice)
    */
    read(id: FileId, range: types.store.BufferReadRange): Promise<Buffer>;
    
    /**
        Create new file under dst with data taken from src
    */
    copy(src: FileId, dst: types.request.FileId): Promise<void>;
    
    /**
        Remove given file. This operation doesn't throw errors if something goes wrong it only logs
    */
    delete(id: FileId): Promise<void>;
    
    /**
        Create new empty temporary file under given id
    */
    create(id: TmpFileId): Promise<void>;
    
    /**
        Append given data to temporary file
    */
    append(id: TmpFileId, buffer: Buffer, seq: number): Promise<void>;
    
    /**
        Assign checksum to given temporary file
    */
    setChecksumAndClose(id: TmpFileId, checksum: Buffer, seqs: number): Promise<void>;
    
    /**
        Commit tempoprary file to make it available for read/copy/delete methods
    */
    commit(id: TmpFileId): Promise<void>;
    
    /**
        Remove temporary file. This operation doesn't throw errors if something goes wrong it only logs
    */
    reject(id: TmpFileId, seq: number): Promise<void>;
    
    /**
        List all files in storage
    */
    list(): Promise<FileId[]>;
    
    /**
        Clear current storage
    */
    clearStorage(): Promise<void>;
    
    /**
        Switch to fresh storage if needed (if clearStorage is not definetely and if after it storage is not fully cleared)
    */
    switchToFreshStorage(): Promise<void>;
    
    /**
        Prepares file to random write. Writes at specified position of file or checksum. At -1 writes at the end of the file. If the provider does not support random write throw an exception.
    */
    randomWritePrepare(id: FileId, operations: types.store.StoreFileRandomWriteOperation[]): Promise<RandomWriteStorageContext>
    
    /**
        Commits writes to file. If the provider does not support random write throw an exception.
    */
    randomWriteCommit(commitContext: RandomWriteStorageContext, session?: mongodb.ClientSession): Promise<{newFileSize: number, newChecksumSize: number}>
}
