import { LockService } from "../../cluster/master/ipcServices/LockService";

export class LockHelper {
    constructor(
        private lockService: LockService,
    ) {}
    
    async withLock<T>(lockName: string, func: () => Promise<T>) {
        await this.lockService.lock({lockName});
        try {
            const result = await func();
            return result;
        }
        finally {
            await this.lockService.unlock({lockName});
        }
    }
}
