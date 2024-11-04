/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { RepositoryFactory } from "../../db/RepositoryFactory";
import { IStorageService } from "../misc/StorageService";
import { CloudKeyService } from "./CloudKeyService";
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { PropDescription, ResourceTypeAcl, ResourceTypeInfo, ResourceTypeInfoX, ResourceTypeProvider } from "./ResourceTypeProvider";
import { DateUtils } from "../../utils/DateUtils";
import { FieldPathParser } from "../../utils/FieldPathParser";

export type ResourceAcl = {type: "embedded", users: types.cloud.UserId[], keys: types.cloud.KeyEntrySet[]}|{type: "ref", ref: types.resource.ResourceId};
export type ResourceProps = {[propName: string]: any};

export class ResourceService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private resourceTypeProvider: ResourceTypeProvider,
        private cloudKeyService: CloudKeyService,
        private storageService: IStorageService,
    ) {
    }
    
    async createResource(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType, keyId: types.core.KeyId, props: ResourceProps, acl: ResourceAcl, requestId: types.request.RequestId|undefined) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        const {parent, result: aclValue} = await this.validateAclForCreating(user, contextId, resInfo.acl, acl, [user.userId], keyId);
        await this.validateProps(contextId, resInfo, props);
        const newProps = await this.checkAndCommitBigBuffersAndReturnsNewProps(user, requestId, resInfo, props);
        const repo = this.repositoryFactory.createResourceRepository(resInfo.collectionName);
        const now = DateUtils.now();
        const resource: db.resource.Resource = {
            id: repo.generateId(),
            type: type,
            contextId: contextId,
            createDate: now,
            creator: user.userId,
            acl: aclValue,
            last: {
                created: now,
                author: user.userId,
                keyId: keyId,
                props: newProps,
            },
            history: [],
            stats: {}
        };
        for (const stat of resInfo.stats || []) {
            resource.stats[stat] = {count: 0, lastDate: now};
        }
        await repo.insert(resource);
        if (aclValue.type === "ref" && resInfo.acl.type === "ref" && resInfo.acl.propagateStats) {
            await this.repositoryFactory.createResourceRepository(this.resourceTypeProvider.getCollectionName(contextId, resInfo.acl.ref)).increaseStats(aclValue.ref, type, resource.createDate);
        }
        // if (request) {
        //     await this.repositoryFactory.createRequestRepository().delete(request.id);
        // }
        // TODO notification
        return {user, parent: parent, resource};
    }
    
    async getResource(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType, id: types.resource.ResourceId) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        const resource = await this.repositoryFactory.createResourceRepository(resInfo.collectionName).get(id);
        if (!resource) {
            throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: type, id: id});
        }
        const {parent} = await this.validateReadAcl(user, contextId, resInfo, resource);
        return {user, resource, parent};
    }
    
    async getResources(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        if (resInfo.acl.type !== "embedded") {
            throw new AppException("CANNOT_QUERY_NOT_ROOT_RESOURCE", {type: type});
        }
        const resources = await this.repositoryFactory.createResourceRepository(resInfo.collectionName).getAllForUser(user.userId);
        return {user, resources};
    }
    
    async getResourcesByParent(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType, parentId: types.resource.ResourceId) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        if (resInfo.acl.type !== "ref") {
            throw new AppException("CANNOT_QUERY_ROOT_RESOURCE", {type: type});
        }
        const repo = this.repositoryFactory.createResourceRepository(this.resourceTypeProvider.getCollectionName(contextId, resInfo.acl.ref));
        const parent = await repo.get(parentId);
        if (!parent) {
            throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: resInfo.acl.ref, id: parentId});
        }
        if (parent.acl.type !== "embedded") {
            throw new AppException("ACCESS_DENIED", "parent acl policy mismatch");
        }
        this.validateAccessToResource(parent, user);
        const resources = await this.repositoryFactory.createResourceRepository(resInfo.collectionName).getAllByParent(parentId);
        return {user, parent, resources};
    }
    
    async downloadResourceBuffer(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType, id: types.resource.ResourceId, fieldPath: string, range: types.store.BufferReadRange) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        const resource = await this.repositoryFactory.createResourceRepository(resInfo.collectionName).get(id);
        if (!resource) {
            throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: type, id: id});
        }
        const {parent} = await this.validateReadAcl(user, contextId, resInfo, resource);
        const field = this.findBufferField(resInfo, resource.last.props, fieldPath);
        if (!field) {
            throw new AppException("RESOURCE_FIELD_DOES_NOT_EXIST", {type: type, id: id});
        }
        const data = await this.storageService.read(field.fileId, range);
        return {user, resource, parent, data};
    }
    
    async updateResource() {
        // if BigBuffer field overwriten release old value
        // you can overwrite only specific fields
        // increase stats in parent
        // notification
        // if (request) {
        //     await this.repositoryFactory.createRequestRepository().delete(request.id);
        // }
    }
    
    async deleteResource(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId, type: types.resource.ResourceType, id: types.resource.ResourceId) {
        const user = await this.getUserFromContext(userPubKey, contextId);
        const resInfo = this.resourceTypeProvider.getInfo(contextId, type);
        const repo = this.repositoryFactory.createResourceRepository(resInfo.collectionName);
        const resource = await repo.get(id);
        if (!resource) {
            throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: type, id: id});
        }
        const parent = await this.validateManageAcl(user, contextId, resInfo, resource);
        await this.deleteChildrenDeep(contextId, resInfo, resource);
        await this.releaseBigBuffers(resInfo, resource);
        await repo.delete(resource.id);
        if (parent) {
            await this.repositoryFactory.createResourceRepository(parent.parentType.collectionName).decreaseStats(parent.parent.id, type, resource.createDate);
        }
        // notification
    }
    
    private async deleteChildrenDeep(contextId: types.context.ContextId, resInfo: ResourceTypeInfoX, resource: db.resource.Resource) {
        for (const childType of resInfo.children || []) {
            const childTypeInfo = this.resourceTypeProvider.getInfo(contextId, childType);
            const childRepo = this.repositoryFactory.createResourceRepository(childTypeInfo.collectionName);
            if ((childTypeInfo.children || []).length > 0) {
                const children = await childRepo.getAllByParent(resource.id);
                for (const child of children) {
                    await this.deleteChildrenDeep(contextId, childTypeInfo, child);
                }
            }
            await childRepo.deleteAllByParent(resource.id);
        }
        await this.releaseBigBuffers(resInfo, resource);
    }
    
    // ============================
    
    private async getUserFromContext(userPubKey: types.core.EccPubKey, contextId: types.context.ContextId) {
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(userPubKey, contextId);
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        return user;
    }
    
    private async validateManageAcl(user: db.context.ContextUser, contextId: types.context.ContextId, resInfo: ResourceTypeInfoX, resource: db.resource.Resource) {
        // TODO maybe add some more checking
        return this.validateReadAcl(user, contextId, resInfo, resource);
    }
    
    private async validateReadAcl(user: db.context.ContextUser, contextId: types.context.ContextId, resInfo: ResourceTypeInfoX, resource: db.resource.Resource) {
        if (resource.acl.type === "embedded") {
            if (resInfo.acl.type !== "embedded") {
                throw new AppException("ACCESS_DENIED", "acl policy mismatch");
            }
            this.validateAccessToResource(resource, user);
            return null;
        }
        else if (resource.acl.type === "ref") {
            if (resInfo.acl.type !== "ref") {
                throw new AppException("ACCESS_DENIED", "acl policy mismatch");
            }
            const parentType = this.resourceTypeProvider.getInfo(contextId, resInfo.acl.ref);
            const repo = this.repositoryFactory.createResourceRepository(parentType.collectionName);
            const parent = await repo.get(resource.acl.ref);
            if (!parent) {
                throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: resInfo.acl.ref, id: resource.acl.ref});
            }
            if (parent.acl.type !== "embedded") {
                throw new AppException("ACCESS_DENIED", "parent acl policy mismatch");
            }
            this.validateAccessToResource(parent, user);
            return {parent, parentType};
        }
        throw new Error("Invalid acl type");
    }
    
    private async validateAclForCreating(user: db.context.ContextUser, contextId: types.context.ContextId, type: ResourceTypeAcl, acl: ResourceAcl, managers: types.cloud.UserId[], keyId: types.core.KeyId): Promise<{parent: db.resource.Resource, result: types.resource.ResourceAcl}> {
        if (type.type === "embedded") {
            if (acl.type !== "embedded") {
                throw new AppException("INVALID_PARAMS", "acl.type expected embedded");
            }
            // TODO check whether user can create root object of this type
            const keys = await this.cloudKeyService.checkKeysAndClients(contextId, [keyId], [], acl.keys, keyId, acl.users, managers);
            const result: types.resource.EmbeddedResourceAcl = {
                type: "embedded",
                users: acl.users,
                managers: managers,
                keys: keys,
            };
            return {parent: null, result};
        }
        if (type.type === "ref") {
            if (acl.type !== "ref") {
                throw new AppException("INVALID_PARAMS", "acl.type expected ref");
            }
            const repo = this.repositoryFactory.createResourceRepository(this.resourceTypeProvider.getCollectionName(contextId, type.ref));
            const resource = await repo.get(acl.ref);
            if (!resource) {
                throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: type.ref, id: acl.ref});
            }
            if (resource.last.keyId != keyId) {
                throw new AppException("INVALID_KEY");
            }
            this.validateAccessToResource(resource, user); // TODO should check rights to create sub objects not normal access
            const result: types.resource.RefResourceAcl = {
                type: "ref",
                ref: acl.ref,
            };
            return {parent: resource, result};
        }
        throw new Error("Invalid acl type");
    }
    
    private validateAccessToResource(resource: db.resource.Resource, user: db.context.ContextUser) {
        if (resource.acl.type !== "embedded" || !resource.acl.users.includes(user.userId)) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private async validateProps(contextId: types.context.ContextId, type: ResourceTypeInfo, props: ResourceProps) {
        await this.validatePropValue(contextId, {type: "object", props: type.props}, props);
    }
    
    private async validatePropValue(contextId: types.context.ContextId, type: PropDescription, value: unknown) {
        if (type.type === "primitive") {
            if (type.primitive === "string") {
                if (typeof(value) !== "string") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
            }
            else if (type.primitive === "boolean") {
                if (typeof(value) !== "boolean") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
            }
            else if (type.primitive === "number") {
                if (typeof(value) !== "number") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
            }
            else if (type.primitive === "bigbuffer") {
                if (typeof(value) !== "number") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
            }
            else {
                throw new Error("Unsupported primitive type");
            }
        }
        else if (type.type === "object") {
            if (typeof(value) !== "object" || value === null) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            for (const propName in value) {
                const propType = type.props[propName];
                if (!propType) {
                    throw new AppException("INVALID_PARAMS", "unexpected field");
                }
            }
            for (const propName in type.props) {
                const propType = type.props[propName];
                if (propType.optional === true && !(propName in value)) {
                    continue;
                }
                const propValue = (value as Record<string, unknown>)[propName];
                if (propType.nullable === true && propValue === null) {
                    continue;
                }
                if (!(propName in value)) {
                    throw new AppException("INVALID_PARAMS", "props missing field");
                }
                await this.validatePropValue(contextId, propType, propValue);
            }
        }
        else if (type.type === "list") {
            if (!Array.isArray(value)) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            for (const arrayElement of value) {
                await this.validatePropValue(contextId, type.eleType, arrayElement);
            }
        }
        else if (type.type === "ref") {
            if (typeof(value) !== "string") {
                throw new AppException("INVALID_PARAMS", "props");
            }
            const repo = this.repositoryFactory.createResourceRepository(this.resourceTypeProvider.getCollectionName(contextId, type.refType));
            const resource = await repo.get(value as types.resource.ResourceId);
            if (!resource) {
                throw new AppException("RESOURCE_DOES_NOT_EXIST", {type: type.refType, id: value});
            }
        }
        else {
            throw new Error("Unsupported primitive type");
        }
    }
    
    private async checkAndCommitBigBuffersAndReturnsNewProps(user: db.context.ContextUser, requestId: types.request.RequestId|undefined, type: ResourceTypeInfo, props: ResourceProps) {
        const request = requestId ? await this.repositoryFactory.createRequestRepository().getWithAccessCheck(user.userPubKey as any, requestId) : null;
        this.checkBigBuffers(request, {type: "object", props: type.props}, props);
        const newProps = await this.commitBigBuffersAndReturnsNewProps(request, {type: "object", props: type.props}, props);
        return newProps as ResourceProps;
    }
    
    private checkBigBuffers(request: db.request.Request|null, type: PropDescription, value: unknown) {
        if (type.type === "primitive") {
            if (type.primitive === "bigbuffer") {
                if (typeof(value) !== "number") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
                if (!request) {
                    throw new AppException("REQUEST_DOES_NOT_EXIST");
                }
                if (!request.files[value]) {
                    throw new AppException("INVALID_FILE_INDEX");
                }
            }
        }
        else if (type.type === "object") {
            if (typeof(value) !== "object" || value === null) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            for (const propName in type.props) {
                const propType = type.props[propName];
                if (propType.optional === true && !(propName in value)) {
                    continue;
                }
                const propValue = (value as Record<string, unknown>)[propName];
                if (propType.nullable === true && propValue === null) {
                    continue;
                }
                if (!(propName in value)) {
                    throw new AppException("INVALID_PARAMS", "props missing field");
                }
                this.checkBigBuffers(request, propType, propValue);
            }
        }
        else if (type.type === "list") {
            if (!Array.isArray(value)) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            for (const arrayElement of value) {
                this.checkBigBuffers(request, type.eleType, arrayElement);
            }
        }
        else if (type.type === "ref") {
            return;
        }
        else {
            throw new Error("Unsupported primitive type");
        }
    }
    
    private async commitBigBuffersAndReturnsNewProps(request: db.request.Request|null, type: PropDescription, value: unknown): Promise<unknown> {
        if (type.type === "primitive") {
            if (type.primitive === "bigbuffer") {
                if (typeof(value) !== "number") {
                    throw new AppException("INVALID_PARAMS", "props");
                }
                if (!request) {
                    throw new AppException("REQUEST_DOES_NOT_EXIST");
                }
                const file = request.files[value];
                if (!file) {
                    throw new AppException("INVALID_FILE_INDEX");
                }
                await this.storageService.commit(file.id);
                return {fileId: file.id, size: file.size};
            }
            return value;
        }
        else if (type.type === "object") {
            if (typeof(value) !== "object" || value === null) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            const result: {[prop: string]: unknown} = {};
            for (const propName in type.props) {
                const propType = type.props[propName];
                if (propType.optional === true && !(propName in value)) {
                    continue;
                }
                const propValue = (value as Record<string, unknown>)[propName];
                if (propType.nullable === true && propValue === null) {
                    continue;
                }
                if (!(propName in value)) {
                    throw new AppException("INVALID_PARAMS", "props missing field");
                }
                result[propName] = await this.commitBigBuffersAndReturnsNewProps(request, propType, propValue);
            }
            return result;
        }
        else if (type.type === "list") {
            if (!Array.isArray(value)) {
                throw new AppException("INVALID_PARAMS", "props");
            }
            const result = [];
            for (const arrayElement of value) {
                result.push(await this.commitBigBuffersAndReturnsNewProps(request, type.eleType, arrayElement));
            }
            return result;
        }
        else if (type.type === "ref") {
            return null;
        }
        else {
            throw new Error("Unsupported primitive type");
        }
    }
    
    private findBufferField(type: ResourceTypeInfo, props: types.resource.ResourceProps, fieldPath: string): {fileId: types.request.FileId, size: number} {
        const propPath = FieldPathParser.parseFieldPath(fieldPath);
        let currentType: PropDescription = {type: "object", props: type.props};
        let currentProp = props;
        for (const entry of propPath) {
            if (currentProp == null || currentType == null) {
                return null;
            }
            if (entry.type === "field") {
                currentProp = (currentProp as any)[entry.name];
                currentType = currentType.type === "object" ? currentType.props[entry.name] : null;
            }
            else {
                currentProp = (currentProp as any)[entry.index];
                currentType = currentType.type === "list" ? currentType.eleType : null;
            }
        }
        return currentType && currentType.type === "primitive" && currentType.primitive === "bigbuffer" ? currentProp as any : null;
    }
    
    private async releaseBigBuffers(resInfo: ResourceTypeInfo, resource: db.resource.Resource) {
        await this.releaseBigBuffersInner({type: "object", props: resInfo.props}, resource.last.props);
    }
    
    private async releaseBigBuffersInner(type: PropDescription, value: unknown) {
        if (type.type === "primitive") {
            if (type.primitive === "bigbuffer") {
                if (value) {
                    await this.storageService.delete((value as any).fileId);
                }
            }
        }
        else if (type.type === "object") {
            if (typeof(value) !== "object" || value === null) {
                return;
            }
            for (const propName in type.props) {
                const propType = type.props[propName];
                if (propType.optional === true && !(propName in value)) {
                    continue;
                }
                const propValue = (value as Record<string, unknown>)[propName];
                if (propType.nullable === true && propValue === null) {
                    continue;
                }
                if (!(propName in value)) {
                    continue;
                }
                await this.releaseBigBuffersInner(propType, propValue);
            }
        }
        else if (type.type === "list") {
            if (!Array.isArray(value)) {
                return;
            }
            for (const arrayElement of value) {
                await this.releaseBigBuffersInner(type.eleType, arrayElement);
            }
        }
        else if (type.type === "ref") {
            return;
        }
        else {
            throw new Error("Unsupported primitive type");
        }
    }
}
