/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { CloudKeyService } from "../../../service/cloud/CloudKeyService";
import { StoreFileRepository } from "../../../service/cloud/StoreFileRepository";
import { StoreNotificationService } from "../../../service/cloud/StoreNotificationService";
import { StoreRepository } from "../../../service/cloud/StoreRepository";
import { StoreService } from "../../../service/cloud/StoreService";
import { IStorageService } from "../../../service/misc/StorageService";
import { RequestRepository } from "../../../service/request/RequestRepository";
import { createMock, hasCalls, hasNoCalls, hasOneCall, mock } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { ContextUserRepository } from "../../../service/cloud/ContextUserRepository";
import { DateUtils } from "../../../utils/DateUtils";
import { ErrorCode, AppException } from "../../../api/AppException";
import { JobService } from "../../../service/job/JobService";
import { Logger } from "../../../service/log/LoggerFactory";
import { CloudAclChecker } from "../../../service/cloud/CloudAclChecker";
import { PolicyService } from "../../../service/cloud/PolicyService";
import { ContextRepository } from "../../../service/cloud/ContextRepository";
import { CloudUser } from "../../../CommonTypes";
import { CloudAccessValidator } from "../../../service/cloud/CloudAccessValidator";

const requestId = "req-1" as types.request.RequestId;
const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const notExistingContextId = "NotExistingContextId" as types.context.ContextId;
const storeId = "MyStoreId" as types.store.StoreId;
const notExistingStoreId = "NotExistingStoreId" as types.store.StoreId;
const janek = "janek" as types.cloud.UserId;
const janekUserPubKey = new CloudUser("SomeUserPubKey" as types.core.EccPubKey);
const bobUserPubKey = new CloudUser("SomeUserPubKeyBob" as types.core.EccPubKey);
const alice = "alice" as types.cloud.UserId;
const aliceUserPubKey = new CloudUser("SomeUserPubKeyAlice" as types.core.EccPubKey);
const users = [janek];
const managers = [janek];
const data = "SomeStoreData" as types.store.StoreData;
const keyId = "SomeKeyId" as types.core.KeyId;
const invalidKeyId = "SomeInvalidKeyId" as types.core.KeyId;
const keys = [{} as types.cloud.KeyEntrySet];
const storeFileId = "MyStoreFileId" as types.store.StoreFileId;
const storeFileIdWithoutThumb = "MyStoreFileIdWithoutThumb" as types.store.StoreFileId;
const notExistingStoreFileId = "NotExistingStoreFileId" as types.store.StoreFileId;
const myContext: db.context.Context = {
    id: contextId,
    created: DateUtils.now(),
    modified: DateUtils.now(),
    description: "" as types.context.ContextDescription,
    name: "" as types.context.ContextName,
    scope: "private",
    shares: [],
    solution: solutionId,
    policy: {},
};
const janekUser: db.context.ContextUser = {
    id: "xxx" as db.context.ContextUserId,
    created: DateUtils.now(),
    contextId: contextId,
    userId: janek,
    userPubKey: janekUserPubKey.pub,
    acl: "ALLOW ALL" as types.cloud.ContextAcl,
};
const aliceUser: db.context.ContextUser = {
    id: "yyy" as db.context.ContextUserId,
    created: DateUtils.now(),
    contextId: contextId,
    userId: alice,
    userPubKey: aliceUserPubKey.pub,
    acl: "ALLOW ALL" as types.cloud.ContextAcl,
};
const store: db.store.Store = {
    id: storeId,
    contextId: contextId,
    createDate: DateUtils.now(),
    creator: janek,
    lastModificationDate: DateUtils.now(),
    lastModifier: janek,
    keyId: keyId,
    data: "" as types.store.StoreData,
    allTimeUsers: [janek],
    users: [janek],
    managers: [janek],
    keys: [],
    history: [],
    lastFileDate: DateUtils.now(),
    files: 0,
    policy: {},
};
const storeFile: db.store.StoreFile = {
    id: storeFileId,
    fileId: "zxc" as types.request.FileId,
    storeId: storeId,
    author: janek,
    createDate: DateUtils.now(),
    meta: "" as types.store.StoreFileMeta,
    size: 1024 as types.core.SizeInBytes,
    checksumSize: 128 as types.core.SizeInBytes,
    keyId: keyId,
    thumb: {
        fileId: "yvb" as types.request.FileId,
        size: 1024 as types.core.SizeInBytes,
        checksumSize: 128 as types.core.SizeInBytes,
    },
};
const storeFileWithoutThumb: db.store.StoreFile = {
    id: storeFileIdWithoutThumb,
    fileId: "zxc" as types.request.FileId,
    storeId: storeId,
    author: janek,
    createDate: DateUtils.now(),
    meta: "" as types.store.StoreFileMeta,
    size: 1024 as types.core.SizeInBytes,
    checksumSize: 128 as types.core.SizeInBytes,
    keyId: keyId,
};
const request: db.request.Request = {
    id: requestId,
    author: "janek" as types.core.Username,
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
            closed: false,
        },
        {
            id: <types.request.FileId>"file-2",
            sent: 2048,
            seq: 1,
            size: 4096,
            checksumSize: 0,
            checksumSent: 0,
            closed: false,
        },
        {
            id: <types.request.FileId>"file-3",
            sent: 2048,
            seq: 5,
            size: 2048,
            checksumSize: 0,
            checksumSent: 0,
            closed: true,
        },
    ],
};
const listParams: types.core.ListModel = {
    skip: 0,
    limit: 0,
    sortOrder: "asc",
};

it("Should create store", async () => {
    // Setup
    const {storeService, storeRepository, storeNotificationService} = createStoreService();
    
    // Act
    const res = await storeService.createStore(janekUserPubKey, contextId, undefined, users, managers, data, keyId, keys, {});
    
    // Asserts
    expect(res).not.toBeNull();
    hasOneCall(storeRepository.createStore);
    hasOneCall(storeNotificationService.sendStoreCreated);
});

it("Should fails on creating store using invalid user", async () => {
    // Setup
    const {storeService, storeRepository} = createStoreService();
    
    // Act & Assert
    try {
        await storeService.createStore(bobUserPubKey, contextId, undefined, users, managers, data, keyId, keys, {});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(storeRepository.createStore);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should get store", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act
    const res = await storeService.getStore(janekUserPubKey, storeId, undefined);
    
    // Asserts
    expect(res).not.toBeNull();
    expect(store.id).toBe(storeId);
});

it("Should fails on getting not existing store", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act & Assert
    try {
        await storeService.getStore(janekUserPubKey, notExistingStoreId, undefined);
    }
    catch (e) {
        expect(AppException.is(e, "STORE_DOES_NOT_EXIST")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should list store", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act
    const res = await storeService.getMyStores(janekUserPubKey, contextId, undefined, listParams, "id");
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.stores.list.length).toBe(1);
});

it("Should fails on list stores from not exisitng context", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act & Assert
    try {
        await storeService.getMyStores(janekUserPubKey, notExistingContextId, undefined, listParams, "id");
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should get store file", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act
    const res = await storeService.getStoreFile(janekUserPubKey, storeFileId);
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
});

it("Should fails on getting not exisitng file", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act & Assert
    try {
        await storeService.getStoreFile(janekUserPubKey, notExistingStoreFileId);
    }
    catch (e) {
        expect(AppException.is(e, "STORE_FILE_DOES_NOT_EXIST")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should list store files", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act
    const res = await storeService.getStoreFiles(janekUserPubKey, storeId, listParams);
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.files.list.length).toBe(1);
});

it("Should fails on listing files from not existing store", async () => {
    // Setup
    const {storeService} = createStoreService();
    
    // Act & Assert
    try {
        await storeService.getStoreFiles(janekUserPubKey, notExistingStoreId, listParams);
    }
    catch (e) {
        expect(AppException.is(e, "STORE_DOES_NOT_EXIST")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should create store file", async () => {
    // Setup
    const {storeService, storeFileRepository, storeRepository, storeNotificationService, storageService, requestRepository} = createStoreService();
    
    // Act
    const res = await storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    });
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
    hasOneCall(storeFileRepository.create);
    hasOneCall(storeRepository.increaseFilesCounter);
    hasCalls(storageService.commit, 2);
    hasOneCall(storeNotificationService.sendStoreFileCreated);
    hasOneCall(storeNotificationService.sendStoreStatsChanged);
    hasOneCall(requestRepository.getReadyForUser);
    hasOneCall(requestRepository.delete);
});

it("Should create store file without thumb", async () => {
    // Setup
    const {storeService, storeFileRepository, storeRepository, storeNotificationService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
    });
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
    hasOneCall(storeFileRepository.create);
    hasOneCall(storeRepository.increaseFilesCounter);
    hasCalls(storageService.commit, 1);
    hasOneCall(storeNotificationService.sendStoreFileCreated);
    hasOneCall(storeNotificationService.sendStoreStatsChanged);
});

function testFail(message: string, error: ErrorCode, func: (storeService: StoreService) => Promise<unknown>) {
    it(message, async () => {
        // Setup
        const {storeService} = createStoreService();
        
        // Act & Assert
        try {
            await func(storeService);
        }
        catch (e) {
            expect(AppException.is(e, error)).toBe(true);
            return;
        }
        expect(true).toBeFalsy();
    });
}

testFail("Should fails on creating file with invalid user", "ACCESS_DENIED", storeService =>
    storeService.createStoreFile(bobUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on creating file in not existing store", "STORE_DOES_NOT_EXIST", storeService =>
    storeService.createStoreFile(janekUserPubKey, {
        storeId: notExistingStoreId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on creating file with invalid key id", "INVALID_KEY", storeService =>
    storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: invalidKeyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on creating file with invalid file index", "INVALID_FILE_INDEX", storeService =>
    storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 5,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on creating file with invalid thumb index", "INVALID_FILE_INDEX", storeService =>
    storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 5,
    }),
);

testFail("Should fails on creating file with the same index for file and thumb", "FILE_ALREADY_USED", storeService =>
    storeService.createStoreFile(janekUserPubKey, {
        storeId: storeId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 0,
    }),
);

it("Should update store file", async () => {
    // Setup
    const {storeService, storeFileRepository, storeNotificationService, storageService, requestRepository} = createStoreService();
    
    // Act
    const res = await storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    });
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
    hasOneCall(storeFileRepository.update);
    hasCalls(storageService.commit, 2);
    hasCalls(storageService.delete, 2);
    hasOneCall(storeNotificationService.sendStoreFileUpdated);
    hasOneCall(requestRepository.getReadyForUser);
    hasOneCall(requestRepository.delete);
});

it("Should update store file without thumb", async () => {
    // Setup
    const {storeService, storeFileRepository, storeNotificationService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
    });
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
    hasOneCall(storeFileRepository.update);
    hasCalls(storageService.commit, 1);
    hasCalls(storageService.delete, 2);
    hasOneCall(storeNotificationService.sendStoreFileUpdated);
});

testFail("Should fails on writing file with invalid user", "ACCESS_DENIED", storeService =>
    storeService.writeStoreFile(bobUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on writing file to not existing file", "STORE_FILE_DOES_NOT_EXIST", storeService =>
    storeService.writeStoreFile(janekUserPubKey, {
        fileId: notExistingStoreFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on creating file with invalid key id", "INVALID_KEY", storeService =>
    storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: invalidKeyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on writing file with invalid file index", "INVALID_FILE_INDEX", storeService =>
    storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 5,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 1,
    }),
);

testFail("Should fails on writing file with invalid thumb index", "INVALID_FILE_INDEX", storeService =>
    storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 5,
    }),
);

testFail("Should fails on writing file with the same index for file and thumb", "FILE_ALREADY_USED", storeService =>
    storeService.writeStoreFile(janekUserPubKey, {
        fileId: storeFileId,
        fileIndex: 0,
        meta: "" as types.store.StoreFileMeta,
        keyId: keyId,
        requestId: requestId,
        thumbIndex: 0,
    }),
);

it("Should delete store file", async () => {
    // Setup
    const {storeService, storeFileRepository, storeRepository, storeNotificationService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.deleteStoreFile(janekUserPubKey, storeFileId);
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileId);
    hasOneCall(storeFileRepository.deleteFile);
    hasOneCall(storeRepository.decreaseFilesCounter);
    hasCalls(storageService.delete, 2);
    hasOneCall(storeNotificationService.sendStoreFileDeleted);
    hasOneCall(storeNotificationService.sendStoreStatsChanged);
});

it("Should delete store file without thumb", async () => {
    // Setup
    const {storeService, storeFileRepository, storeRepository, storeNotificationService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.deleteStoreFile(janekUserPubKey, storeFileIdWithoutThumb);
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.file.id).toBe(storeFileIdWithoutThumb);
    hasOneCall(storeFileRepository.deleteFile);
    hasOneCall(storeRepository.decreaseFilesCounter);
    hasCalls(storageService.delete, 1);
    hasOneCall(storeNotificationService.sendStoreFileDeleted);
    hasOneCall(storeNotificationService.sendStoreStatsChanged);
});

testFail("Should fails on deleting not exisitng file", "STORE_FILE_DOES_NOT_EXIST", storeService =>
    storeService.deleteStoreFile(janekUserPubKey, notExistingStoreFileId),
);

it("Should read store file data", async () => {
    // Setup
    const {storeService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.readStoreFile(janekUserPubKey, storeFileId, false, undefined, {type: "all"});
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.data.length).toBe(1024);
    hasCalls(storageService.read, 1);
});

it("Should read store file thumb data", async () => {
    // Setup
    const {storeService, storageService} = createStoreService();
    
    // Act
    const res = await storeService.readStoreFile(janekUserPubKey, storeFileId, true, undefined, {type: "all"});
    
    // Asserts
    expect(res).not.toBeNull();
    expect(res.data.length).toBe(1024);
    hasCalls(storageService.read, 1);
});

testFail("Should fails on reading with invalid user", "ACCESS_DENIED", storeService =>
    storeService.readStoreFile(bobUserPubKey, storeFileId, false, undefined, {type: "all"}),
);

testFail("Should fails on reading with user without access", "ACCESS_DENIED", storeService =>
    storeService.readStoreFile(aliceUserPubKey, storeFileId, false, undefined, {type: "all"}),
);

testFail("Should fails on reading not exisitng file", "STORE_FILE_DOES_NOT_EXIST", storeService =>
    storeService.readStoreFile(janekUserPubKey, notExistingStoreFileId, false, undefined, {type: "all"}),
);

testFail("Should fails on reading not exisitng thumb", "FILES_CONTAINER_FILE_HAS_NOT_THUMB", storeService =>
    storeService.readStoreFile(janekUserPubKey, storeFileIdWithoutThumb, true, undefined, {type: "all"}),
);

function createStoreService() {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const cloudKeyService = createMock<CloudKeyService>({});
    const storeNotificationService = createMock<StoreNotificationService>({});
    const storageService = createMock<IStorageService>({});
    const storeRepository = createMock<StoreRepository>({});
    const storeFileRepository = createMock<StoreFileRepository>({});
    const requestRepository = createMock<RequestRepository>({});
    const contextUserRepository = createMock<ContextUserRepository>({});
    const contextRepository = createMock<ContextRepository>({});
    const jobService = createMock<JobService>({});
    const logger = createMock<Logger>({});
    const cloudAclChecker = new CloudAclChecker();
    const policyService = new PolicyService();
    const cloudAccessValidator = createMock<CloudAccessValidator>({});
    const storeService = new StoreService(repositoryFactory, cloudKeyService, storeNotificationService, storageService, jobService, logger, cloudAclChecker, policyService, cloudAccessValidator);
    
    mock(storageService, "commit", async () => {});
    mock(storageService, "delete", async () => {});
    mock(storageService, "read", async () => Buffer.alloc(1024));
    
    mock(repositoryFactory, "createStoreRepository", () => storeRepository);
    mock(repositoryFactory, "createStoreFileRepository", () => storeFileRepository);
    mock(repositoryFactory, "createRequestRepository", () => requestRepository);
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(repositoryFactory, "createContextRepository", () => contextRepository);
    
    mock(jobService, "addJob", () => {});
    mock(cloudKeyService, "checkKeysAndClients", async () => []);
    mock(cloudKeyService, "checkKeysAndUsersDuringCreation", async () => []);
    
    mock(contextUserRepository, "getUserFromContext", async (pub, ctx) =>
        pub === janekUserPubKey.pub && ctx == contextId ? janekUser : (pub === aliceUserPubKey.pub && ctx == contextId ? aliceUser : null));
    mock(contextRepository, "get", async (id) => id === contextId ? myContext : null);
    
    mock(storeRepository, "createStore", async () => store);
    mock(storeRepository, "get", async (id) => id === storeId ? store : null);
    mock(storeRepository, "getPageByContextAndUser", async () => ({list: [store], count: 1}));
    mock(storeRepository, "increaseFilesCounter", async () => {});
    mock(storeRepository, "decreaseFilesCounter", async () => {});
    mock(storeRepository, "updateLastFileDate", async () => {});
    
    mock(requestRepository, "getReadyForUser", async () => request);
    mock(requestRepository, "delete", async () => {});
    
    mock(storeFileRepository, "get", async (id) => id === storeFileId ? storeFile : (id == storeFileIdWithoutThumb ? storeFileWithoutThumb : null));
    mock(storeFileRepository, "getPageByStore", async () => ({list: [storeFile], count: 1}));
    mock(storeFileRepository, "create", async () => storeFile);
    mock(storeFileRepository, "update", async () => storeFile);
    mock(storeFileRepository, "deleteFile", async () => {});
    
    mock(storeNotificationService, "sendStoreCreated", () => {});
    mock(storeNotificationService, "sendStoreStatsChanged", () => {});
    mock(storeNotificationService, "sendStoreFileCreated", () => {});
    mock(storeNotificationService, "sendStoreFileUpdated", () => {});
    mock(storeNotificationService, "sendStoreFileDeleted", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const user = cloudUser.pub === janekUserPubKey.pub && ctx == contextId ? janekUser : (cloudUser.pub === aliceUserPubKey.pub && ctx == contextId ? aliceUser : null);
        const context = ctx === contextId ? myContext : null;
        if (!user || !context) {
            throw new AppException("ACCESS_DENIED");
        }
        return {user, context};
    });
    mock(cloudAccessValidator, "checkIfCanExecuteInContext", async (executor, ctx, onCloudUser) => {
        if (executor.type !== "cloud") {
            throw new Error(`Unsupported executor type=${executor.type}`);
        }
        if (typeof ctx === "string") {
            const {user, context} = await cloudAccessValidator.getUserFromContext(executor, ctx);
            await onCloudUser(user, context);
            return context;
        }
        else {
            return ctx;
        }
    });
    
    return {
        storeService,
        repositoryFactory,
        cloudKeyService,
        storeNotificationService,
        storageService,
        storeRepository,
        storeFileRepository,
        requestRepository,
        contextUserRepository,
        contextRepository,
        cloudAclChecker,
        policyService,
        cloudAccessValidator,
    };
}
