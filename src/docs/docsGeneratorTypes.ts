/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Validator } from "adv-validator/out/Types";
import { ExportedMethodOptions } from "../api/Decorators";

export interface Api {
    name: string;
    prefix: string;
    methods: {[name: string]: ApiMethod};
}

export interface ApiMethod {
    name: string;
    fullName: string;
    description: string;
    parameters: {[name: string]: PropertyDeclaration};
    returns: ReturnedType;
    options: ExportedMethodOptions;
    exampleParameters: any;
    exampleResult: any;
}

export type Type = PrimitiveType|LiteralType|ObjectType|ArrayType|NullableType|UnionType|EnumType|TypeDeclarationType;

export interface EnumType {
    kind: "enum";
    type: "number"|"string"|"boolean"|"unknown";
    parent?: string;
    values: any[];
    validator?: Validator
}
export interface PrimitiveType {
    kind: "primitive";
    type: "number"|"string"|"boolean"|"unknown";
    parent?: string;
    validator?: Validator
}

export interface LiteralType {
    kind: "literal";
    type: "number"|"string"|"boolean"|"null";
    parent?: string;
    value: any;
    validator?: Validator
}

export interface TypeDeclarationType {
    kind: "typeDeclaration";
    parent?: string;
    validator?: Validator;
}
export interface ObjectType {
    kind: "object";
    name: string;
    description: string;
    properties: {[name: string]: PropertyDeclaration};
    validator?: Validator
    parent?: string;
}

export interface PropertyDeclaration {
    name: string;
    description: string;
    map?: Type;
    type: Type;
    optional: boolean;
}

export interface ArrayType {
    kind: "array";
    type: Type;
    validator?: Validator
    parent?: string;
}

export interface NullableType {
    kind: "nullable";
    type: Type;
    validator?: Validator
    parent?: string;
}

export interface UnionType {
    kind: "union";
    types: Type[];
    validator?: Validator
    parent?: string;
}

export interface ReturnedType {
    description: string;
    type: Type;
}

export interface ErrorWithDescription {
    code: number,
    message: string,
    description: string
}

export interface HttpErrorCode {
    errorCode: string,
    message: string,
    description: string
}

export interface JsonRpcErrorCodes {
    [name: string]: {
        code: number;
        message: string;
        description?: string;
    };
}

export interface JsonDocs {
    errorsWithDescription: ErrorWithDescription[],
    apis: {[name: string]: Api},
    httpErrorCodes: HttpErrorCode[],
    jsonRpcErrors: JsonRpcErrorCodes,
    aclGroups: AclGroups,
}
export type AclRecord = Record<string, string[]>;
export type AclGroup = {[key: string]: AclRecord};
export interface AclGroups {
    groups: AclGroup
};
