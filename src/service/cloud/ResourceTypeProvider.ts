/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { AppException } from "../../api/AppException";

export interface ResourceTypeInfo {
    type: types.resource.ResourceType;
    acl: ResourceTypeAcl;
    props: {[propName: string]: PropDescription};
    children?: types.resource.ResourceType[];
    stats?: types.resource.ResourceType[];
}

export interface ResourceTypeInfoX extends ResourceTypeInfo {
    collectionName: ResourceCollectionName;
}

export type ResourceCollectionName = string&{__resourceCollectionName: never};

export type ResourceTypeAcl = {type: "embedded"}|{type: "ref", ref: types.resource.ResourceType, propagateStats?: boolean};

export type PropDescription = PrimitivePropDescription|ObjectPropDescription|ListPropDescription|ReferencePropDescription;

export interface PrimitivePropDescription {
    type: "primitive";
    primitive: "number"|"boolean"|"string"|"bigbuffer"; // |"buffer";
    nullable?: boolean;
    optional?: boolean;
}

export interface ObjectPropDescription {
    type: "object";
    props: {[propName: string]: PropDescription};
    nullable?: boolean;
    optional?: boolean;
}

export interface ListPropDescription {
    type: "list";
    eleType: PropDescription;
    nullable?: boolean;
    optional?: boolean;
}

export interface ReferencePropDescription {
    type: "ref";
    refType: types.resource.ResourceType;
    nullable?: boolean;
    optional?: boolean;
}

// TODO dodać validatory (min/max, regex, minLength/maxLength) i typy z obecnych validatorów?
// TODO dodać type: długi string, długi buffer, external buffer

export class ResourceTypeProvider {
    
    private map: Map<types.resource.ResourceType, ResourceTypeInfo>;
    
    constructor() {
        this.map = new Map();
        const threadType = "thread" as types.resource.ResourceType;
        const messageType = "message" as types.resource.ResourceType;
        this.insert({
            type: threadType,
            acl: {type: "embedded"},
            props: {
                meta: {type: "primitive", primitive: "string"},
            },
            children: [messageType],
            stats: [messageType],
        });
        this.insert({
            type: "message" as types.resource.ResourceType,
            acl: {type: "ref", ref: threadType, propagateStats: true},
            props: {
                meta: {type: "primitive", primitive: "string"},
            }
        });
        // const store = this.insert({
        //     type: "store" as types.resource.ResourceType,
        //     acl: {type: "embedded"},
        //     props: {
        //         meta: {type: "primitive", primitive: "string"},
        //     },
        //     children: ["storeFile" as types.resource.ResourceType],
        //     stats: ["storeFile" as types.resource.ResourceType],
        // });
        // this.insert({
        //     type: "storeFile" as types.resource.ResourceType,
        //     acl: {type: "ref", ref: store.type, propagateStats: true},
        //     props: {
        //         meta: {type: "primitive", primitive: "string"},
        //         data: {type: "primitive", primitive: "bigbuffer"},
        //         thumb: {type: "primitive", primitive: "bigbuffer", optional: true},
        //     }
        // });
    }
    
    insert(info: ResourceTypeInfo) {
        if (this.map.has(info.type)) {
            throw new Error(`ResourceType already registered '${info.type}'`);
        }
        this.map.set(info.type, info);
        return info;
    }
    
    getInfo(contextId: types.context.ContextId, type: types.resource.ResourceType) {
        const entry = this.map.get(type);
        if (!entry) {
            throw new AppException("UNSUPPORTED_RESOURCE_TYPE", type);
        }
        const res: ResourceTypeInfoX = {
            collectionName: this.getCollectionName(contextId, type),
            ...entry
        };
        return res;
    }
    
    getCollectionName(contextId: types.context.ContextId, type: types.resource.ResourceType) {
        return `r_${contextId}_${type}` as ResourceCollectionName;
    }
}
