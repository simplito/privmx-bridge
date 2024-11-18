/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */

import "q2-test";
import { ConfigService } from "../../../service/config/ConfigService";
import { RequestService } from "../../../service/request/RequestService";
import { ANY, createFake, createMock, hasNoCalls, hasOneCallWithArguments, mock } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { ConfigValues } from "../../../service/config/ConfigLoader";
import { AppException } from "../../../api/AppException";
import { DateUtils } from "../../../utils/DateUtils";
import { IStorageService } from "../../../service/misc/StorageService";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { RequestRepository } from "../../../service/request/RequestRepository";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { StringLogger } from "../../testUtils/logger/StringLogger";
import * as mongodb from "mongodb";

const requestId = <types.request.RequestId>"req-1";
const notExistentRequestId = <types.request.RequestId>"req-2";
const janek = <types.core.Username>"janek";
const bob = <types.core.Username>"bob";

it("Should create request", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act
    const req = await requestService.createRequest(janek, {
        files: [{size: 1000, checksumSize: 0}, {size: 2000, checksumSize: 0}]
    });
    
    // Asserts
    expect(req).not.toBeNull();
    expect(req.processing).toBe(false);
    hasOneCallWithArguments(repository.insert, [ANY]);
});

it("Should fails during creating request with file size exceeded", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.createRequest(janek, {
            files: [{size: 5000001, checksumSize: 0}]
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_FILE_SIZE_EXCEEDED")).toBe(true);
        hasNoCalls(repository.insert);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during creating request which has too many files", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.createRequest(janek, {
            files: [{size: 1000, checksumSize: 0}, {size: 1000, checksumSize: 0}, {size: 1000, checksumSize: 0}, {size: 1000, checksumSize: 0}, {size: 1000, checksumSize: 0}, {size: 1000, checksumSize: 0}]
        });
    }
    catch (e) {
        expect(AppException.is(e, "TOO_MANY_FILES_IN_REQUEST")).toBe(true);
        hasNoCalls(repository.insert);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during creating request which size is exceeded", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.createRequest(janek, {
            files: [{size: 400000, checksumSize: 0}, {size: 400000, checksumSize: 0}, {size: 400000, checksumSize: 0}]
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_SIZE_EXCEEDED")).toBe(true);
        hasNoCalls(repository.insert);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should switch the request to processing state", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act
    const req = await requestService.markRequestAsProcessing(requestId);
    
    // Asserts
    expect(req).not.toBeNull();
    expect(req.processing).toBe(true);
    hasOneCallWithArguments(repository.update, [ANY]);
});

it("Should fails during switching nonexistent request to processing state", async () => {
    // Setup
    const {requestService, repository} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.markRequestAsProcessing(notExistentRequestId);
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_DOES_NOT_EXIST")).toBe(true);
        hasNoCalls(repository.update);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should send chunk to request", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    const data = Buffer.alloc(100);
    
    // Act
    const req = await requestService.sendChunk(janek, {
        requestId: requestId,
        seq: 0,
        data: data,
        fileIndex: 0
    });
    
    // Asserts
    expect(req).not.toBeNull();
    expect(req.processing).toBe(false);
    expect(req.files[0].closed).toBe(false);
    hasOneCallWithArguments(repository.update, [ANY]);
    hasOneCallWithArguments(fileSystemService.append, [ANY, data, 0]);
});

it("Should commit file", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    const checksum = Buffer.alloc(100);
    
    // Act
    const req = await requestService.commitFile(janek, {
        requestId: requestId,
        seq: 0,
        checksum: checksum,
        fileIndex: 0
    });
    
    // Asserts
    expect(req).not.toBeNull();
    expect(req.processing).toBe(false);
    expect(req.files[0].closed).toBe(true);
    expect(req.files[1].closed).toBe(false);
    hasOneCallWithArguments(repository.update, [ANY]);
    hasOneCallWithArguments(fileSystemService.setChecksumAndClose, [ANY, checksum, 0]);
});

it("Should fails during sending chunk to notexistent request", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(janek, {
            requestId: notExistentRequestId,
            seq: 0,
            data: Buffer.alloc(100),
            fileIndex: 0
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_DOES_NOT_EXIST")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during sending chunk to not mine request", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(bob, {
            requestId: notExistentRequestId,
            seq: 0,
            data: Buffer.alloc(100),
            fileIndex: 0
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_DOES_NOT_EXIST")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during sending chunk to notexistent file", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(janek, {
            requestId: requestId,
            seq: 0,
            data: Buffer.alloc(100),
            fileIndex: 123
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_FILE_DOES_NOT_EXIST")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during sending chunk to closed file", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(janek, {
            requestId: requestId,
            seq: 0,
            data: Buffer.alloc(100),
            fileIndex: 2
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_FILE_ALREADY_CLOSED")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during sending chunk and exceeded file size", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(janek, {
            requestId: requestId,
            seq: 0,
            data: Buffer.alloc(10000),
            fileIndex: 0
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_FILE_SIZE_EXCEEDED")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fails during sending chunk with invalid seq", async () => {
    // Setup
    const {requestService, repository, fileSystemService} = createRequestService();
    
    // Act & Assert
    try {
        await requestService.sendChunk(janek, {
            requestId: requestId,
            seq: 66,
            data: Buffer.alloc(100),
            fileIndex: 0
        });
    }
    catch (e) {
        expect(AppException.is(e, "REQUEST_FILE_DESYNCHRONIZED")).toBe(true);
        hasNoCalls(repository.update);
        hasNoCalls(fileSystemService.append);
        return;
    }
    expect(true).toBeFalsy();
});

function createRequestService() {
    const request: db.request.Request = {
        id: requestId,
        author: janek,
        created: DateUtils.now(),
        modified: DateUtils.now(),
        processing: false,
        files: [
            {
                id: <types.request.FileId>"file-0",
                sent: 0,
                seq: 0,
                size: 1024,
                checksumSize: 100,
                checksumSent: 0,
                closed: false
            },
            {
                id: <types.request.FileId>"file-2",
                sent: 2048,
                seq: 1,
                size: 4096,
                checksumSize: 0,
                checksumSent: 0,
                closed: false
            },
            {
                id: <types.request.FileId>"file-3",
                sent: 2048,
                seq: 5,
                size: 2048,
                checksumSize: 0,
                checksumSent: 0,
                closed: true
            }
        ]
    };
    const repository = createMock<MongoObjectRepository<types.request.RequestId, db.request.Request>>({});
    mock(repository, "generateId");
    mock(repository, "get", async id => id === request.id ? request : null);
    mock(repository, "insert");
    mock(repository, "update");
    const repositoryFactory = createMock<RepositoryFactory>({});
    mock(repositoryFactory, "withTransaction", f => f({} as mongodb.ClientSession));
    mock(repositoryFactory, "createRequestRepository", () => new RequestRepository(repository));
    const configService = createFake<ConfigService>({values: createFake<ConfigValues>({request: {
        chunkSize: 100,
        maxFilesCount: 5,
        maxFileSize: 500000,
        maxRequestSize: 1000000,
        clearInterval: DateUtils.minutes(10),
        maxInactiveTime: DateUtils.minutes(10),
        tmpDir: "/tmp",
        filesDir: "/storage"
    }})});
    const fileSystemService = createMock<IStorageService>({});
    mock(fileSystemService, "create");
    mock(fileSystemService, "append");
    mock(fileSystemService, "setChecksumAndClose");
    const requestService = new RequestService(configService, fileSystemService, repositoryFactory, new StringLogger());
    return {
        repository,
        repositoryFactory,
        configService,
        fileSystemService,
        requestService
    };
}