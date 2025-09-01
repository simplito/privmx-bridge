import * as types from "../../types";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { Callbacks } from "../event/Callbacks";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { AggregatedNotificationsService } from "../../cluster/master/ipcServices/AggregatedNotificationsService";
import { JobService } from "../job/JobService";
import { ConfigService } from "../config/ConfigService";

export class UserStatusManager {
    
    constructor(
        private activeUsersMap: ActiveUsersMap,
        private callbacks: Callbacks,
        private repositoryFactory: RepositoryFactory,
        private aggregatedNotificationsService: AggregatedNotificationsService,
        private jobService: JobService,
        private configService: ConfigService,
    ) {}
    
    async incrementUserActiveSessions(instanceHost: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId) {
        const {usage: activeSessions} = await this.activeUsersMap.setUserAsActive({host: instanceHost, userPubkey, solutionId});
        if (activeSessions === 1) {
            this.jobService.addJob(async () => {
                const action = "login";
                void this.repositoryFactory.createKnownPublicKeysRepository().upsertKeyStatus(instanceHost, solutionId, userPubkey, action);
                const userIdentities = await this.repositoryFactory.createContextUserRepository().getAllByUserPubKey(userPubkey);
                void this.activeUsersMap.addToActiveContextUsers({userIdentities});
                void this.aggregatedNotificationsService.aggregateDataForcontextUserStatusChangedNotification({userIdentities: userIdentities, host: this.getHost(), action});
            }, "User status update error (login)");
        }
        this.callbacks.triggerZ("webSocketNewUserAuthorized", [userPubkey, solutionId]);
    }
    
    async decrementUserActiveSessions(instanceHost: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId) {
        const {usage: activeSessions} = await this.activeUsersMap.setUserAsInactive({host: instanceHost, userPubkey, solutionId});
        if (activeSessions === 0) {
            this.jobService.addJob(async () => {
                const action = "logout";
                void this.repositoryFactory.createKnownPublicKeysRepository().upsertKeyStatus(instanceHost, solutionId, userPubkey, action);
                const userIdentities = await this.repositoryFactory.createContextUserRepository().getAllByUserPubKey(userPubkey);
                void this.activeUsersMap.removeFromActiveContextUsers({userIdentities});
                void this.aggregatedNotificationsService.aggregateDataForcontextUserStatusChangedNotification({userIdentities: userIdentities, host: this.getHost(), action});
            }, "User status update error (logout)");
        }
        this.callbacks.triggerZ("userDisconnected", [userPubkey, solutionId]);
    }
    
    private getHost() {
        return this.configService.values.domain as types.core.Host;
    }
}
