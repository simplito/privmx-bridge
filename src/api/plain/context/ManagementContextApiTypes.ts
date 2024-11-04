/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface CreateContextModel {
    /** solution's id */
    solution: types.cloud.SolutionId;
    /** context's name */
    name: types.context.ContextName;
    /** context's description */
    description: types.context.ContextDescription;
    /** context's scope, public or private */
    scope: types.context.ContextScope;
    /** context's <a href="#policy">policy</a> */
    policy?: types.context.ContextPolicy;
}

export interface UpdateContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** context's name */
    name?: types.context.ContextName;
    /** context's description */
    description?: types.context.ContextDescription;
    /** context's scope, public or private */
    scope?: types.context.ContextScope;
    /** context's <a href="#policy">policy</a> */
    policy?: types.context.ContextPolicy;
}

export interface CreateContextResult {
    /** context's id */
    contextId: types.context.ContextId;
}

export interface DeleteContextModel {
    /** context's id */
    contextId: types.context.ContextId;
}

export interface AddUserToContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** user's id */
    userId: types.cloud.UserId;
    /** context user's public key */
    userPubKey: types.cloud.UserPubKey;
    /** user <a href="#introduction-to-acl">acl</a> */
    acl?: types.cloud.ContextAcl;
}

export interface RemoveUserFromContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** user's id */
    userId: types.cloud.UserId;
}

export interface RemoveUserFromContextByPubKeyModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** context user's public key */
    userPubKey: types.cloud.UserPubKey;
}

export interface AddSolutionToContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** solution's id */
    solutionId: types.cloud.SolutionId;
}

export interface RemoveSolutionFromContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** solution's id */
    solutionId: types.cloud.SolutionId;
}

export interface GetContextModel {
    /** context's id */
    contextId: types.context.ContextId;
}

export interface GetContextResult {
    /** context's info */
    context: Context;
}

export type ListContextsModel = types.core.ListModel;

export interface ListContextsOfSolutionModel extends types.core.ListModel {
    /** solution's id */
    solutionId: types.cloud.SolutionId;
}

export interface ListContextsResult {
    /** contexts list */
    list: Context[];
    /** list elements count */
    count: number;
}

export interface Context {
    /** context's id */
    id: types.context.ContextId;
    /** context's creation timestamp */
    created: types.core.Timestamp;
    /** context's modification timestamp */
    modified: types.core.Timestamp;
    /** context's main solution*/
    solution: types.cloud.SolutionId;
    /** context's name */
    name: types.context.ContextName;
    /** context's description */
    description: types.context.ContextDescription;
    /** context's scope*/
    scope: types.context.ContextScope;
    /** context's shares */
    shares: types.cloud.SolutionId[];
    /** context's <a href="#policy">policy</a> */
    policy: types.context.ContextPolicy;
}

export interface GetUserFromContextModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** user's id */
    userId: types.cloud.UserId;
}

export interface GetUserFromContextResult {
    /** user info */
    user: ContextUser;
}

export interface ContextUser {
    /** user's id */
    userId: types.cloud.UserId;
    /** context user's public key */
    pubKey: types.cloud.UserPubKey;
    /** context user's creation date */
    created: types.core.Timestamp;
    /** context's id */
    contextId: types.context.ContextId;
    /** user <a href="#introduction-to-acl">acl</a> */
    acl: types.cloud.ContextAcl;
}

export interface GetUserFromContextByPubKeyModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** context user's public key */
    pubKey: types.cloud.UserPubKey;
}

export interface ListUsersFromContextModel extends types.core.ListModel {
    /** context's id */
    contextId: types.context.ContextId;
}

export interface ListUsersFromContextResult {
    users: ContextUser[];
    /** list elements count */
    count: number;
}

export interface SetUserAclModel {
    /** context's id */
    contextId: types.context.ContextId;
    /** user's id */
    userId: types.cloud.UserId;
    /** user <a href="#introduction-to-acl">acl</a> */
    acl: types.cloud.ContextAcl;
}

export interface IContextApi {
    /**
    * Get context by given id
    * @param model context's id
    * @returns context's info
    */
    getContext(model: GetContextModel): Promise<GetContextResult>;
    
    /**
    * Get list of all contexts
    * @param model list model
    * @returns list of contexts
    */
    listContexts(model: ListContextsModel): Promise<ListContextsResult>;
    
    /**
    * Get list of all contexts of given solution
    * @param model solution's id
    * @returns list of contexts
    */
    listContextsOfSolution(model: ListContextsOfSolutionModel): Promise<ListContextsResult>;
    
    /**
    * Creates new application context with given options
    * @param model context's info
    * @returns id of newly created context
    */
    createContext(model: CreateContextModel): Promise<CreateContextResult>;
    
    /**
    * Updates existing context properties
    * @param model context's id, optional name, description or scope
    * @returns "OK"
    */
    updateContext(model: UpdateContextModel): Promise<types.core.OK>;
    
    /**
    * Removes context
    * @param model context's id
    * @returns "OK"
    */
    deleteContext(model: DeleteContextModel): Promise<types.core.OK>;
    
    /**
    * Creates connection between context and solution
    * @param model context's id, solution's id
    * @returns "OK"
    */
    addSolutionToContext(model: AddSolutionToContextModel): Promise<types.core.OK>;
    
    /**
    * Removes connection between context and solution
    * @param model context's id, solution's id
    * @returns "OK"
    */
    removeSolutionFromContext(model: RemoveSolutionFromContextModel): Promise<types.core.OK>;
    
    /**
    * Add user to context with given id
    * @param model context's id and context user's info
    * @returns "OK"
    */
    addUserToContext(model: AddUserToContextModel): Promise<types.core.OK>;
    
    /**
    * Removes user from the context
    * @param model context's id, context user's id
    * @returns "OK"
    */
    removeUserFromContext(model: RemoveUserFromContextModel): Promise<types.core.OK>;
    
    /**
    * Removes user form the context by user's public key
    * @param model context's id, context user's public key
    * @returns "OK"
    */
    removeUserFromContextByPubKey(model: RemoveUserFromContextByPubKeyModel): Promise<types.core.OK>;
    
    /**
    * Get user from context
    * @param model context's id, context user's id
    * @returns info about user of the context
    */
    getUserFromContext(model: GetUserFromContextModel): Promise<GetUserFromContextResult>;
    
    /**
    * Get user from context by user's public key
    * @param model contex'st id, context user's public key
    * @returns info about user of a context
    */
    getUserFromContextByPubKey(model: GetUserFromContextByPubKeyModel): Promise<GetUserFromContextResult>;
    
    /**
    * Get list of all users in the given context
    * @param model context's id
    * @returns list of context users
    */
    listUsersFromContext(model: ListUsersFromContextModel): Promise<ListUsersFromContextResult>;
    
    /**
    * updates user <a href="#introduction-to-acl">ACL</a>
    * @param model user's id, context's id, acl
    * @returns "OK"
    */
    setUserAcl(model: SetUserAclModel): Promise<types.core.OK>;
}