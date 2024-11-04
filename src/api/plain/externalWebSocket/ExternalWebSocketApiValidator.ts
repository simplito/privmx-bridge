import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class ExternalWebSocketApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("process", this.builder.createObject({
            data: this.tv.base64,
            ip: this.tv.ip,
            connectionId: this.builder.maxLength(this.builder.string, 1024),
        }));
        
        this.registerMethod("setUsersStatus", this.builder.createObject({
            users: this.builder.createListWithMaxLength(this.builder.createObject({
                username: this.tv.username,
                hasOpenedWebSocket: this.builder.bool,
            }), 100)
        }));
    }
}
