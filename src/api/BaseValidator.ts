/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as AdvValidator from "adv-validator";
import { AppException } from "./AppException";

export abstract class BaseValidator implements AdvValidator.Types.PerNameValidator {
    
    protected methods = new Map<string, AdvValidator.Types.Validator>();
    protected builder = new AdvValidator.ValidatorBuilder();
    protected checker = new AdvValidator.ValidatorChecker();
    
    registerMethod(method: string, validator: AdvValidator.Types.Validator) {
        if (this.methods.has(method)) {
            throw new Error(`Method '${method}' already registered`);
        }
        this.methods.set(method, validator);
    }
    
    validate(method: string, data: any): void {
        const validator = this.getValidator(method);
        try {
            this.checker.validateValue(data, validator);
        }
        catch (e: any) {
            const errorName = AdvValidator.ValidatorException.getErrorNameFromException(e);
            const errorData = e ? (<{message: string}>e).message : "";
            throw new AppException(AppException.isValidApiErrorCode(errorName) ? errorName : "INTERNAL_ERROR", errorData);
        }
    }
    
    getValidator(method: string) {
        const validator = this.methods.get(method);
        if (!validator) {
            throw new Error(`Cannot find validator for method '${method}'`);
        }
        return validator;
    }
}
