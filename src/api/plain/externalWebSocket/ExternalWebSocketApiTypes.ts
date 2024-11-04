import * as types from "../../../types";

export interface ProcessModel {
    data: types.core.Base64;
    ip: types.core.IPAddress;
    connectionId: string;
}

export interface ProcessResult {
    data: types.core.Base64;
}

export interface SetUsersStatusModel {
    users: {
        username: types.core.Username;
        hasOpenedWebSocket: boolean;
    }[];
}

export interface IExternalWebSocketApi {
    process(model: ProcessModel): Promise<ProcessResult>;
    setUsersStatus(model: SetUsersStatusModel): Promise<types.core.OK>;
}