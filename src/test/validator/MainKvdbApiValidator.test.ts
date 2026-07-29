/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import * as kvdbApiTypes from "../../api/main/kvdb/KvdbApiTypes";
import { KvdbApiValidator } from "../../api/main/kvdb/KvdbApiValidator";
import { TypesValidator } from "../../api/TypesValidator";
import { Utils } from "../../utils/Utils";

it("KvdbApiValidator.EntryKeyNoWhitespaces", () => {
    const typesValidator = new KvdbApiValidator(new TypesValidator());
    const example: kvdbApiTypes.KvdbEntrySetModel = {
        kvdbId: "ffghdksghjkdgjdg" as types.kvdb.KvdbId,
        kvdbEntryKey: "4rt4tet4ete" as types.kvdb.KvdbEntryKey,
        kvdbEntryValue: "456789y" as types.kvdb.KvdbEntryValue,
        keyId: "dgjhfgjdhghj" as types.core.KeyId,
    };
    const result = Utils.try(() => typesValidator.validate("kvdbEntrySet", example));
    expect(result.success).toBe(true);
});

it("KvdbApiValidator.EntryKeyWithWhitespaces", () => {
    const typesValidator = new KvdbApiValidator(new TypesValidator());
    const example: kvdbApiTypes.KvdbEntrySetModel = {
        kvdbId: "ffghdksghjkdgjdg" as types.kvdb.KvdbId,
        kvdbEntryKey: "4rt 4tet4e te" as types.kvdb.KvdbEntryKey,
        kvdbEntryValue: "456789y" as types.kvdb.KvdbEntryValue,
        keyId: "dgjhfgjdhghj" as types.core.KeyId,
    };
    const result = Utils.try(() => typesValidator.validate("kvdbEntrySet", example));
    expect(result.success).toBe(false);
});

it("KvdbApiValidator.EntryKeyOfInvalidLength", () => {
    const typesValidator = new KvdbApiValidator(new TypesValidator());
    const example: kvdbApiTypes.KvdbEntrySetModel = {
        kvdbId: "ffghdksghjkdgjdg" as types.kvdb.KvdbId,
        kvdbEntryKey: "" as types.kvdb.KvdbEntryKey,
        kvdbEntryValue: "456789y" as types.kvdb.KvdbEntryValue,
        keyId: "dgjhfgjdhghj" as types.core.KeyId,
    };
    const result = Utils.try(() => typesValidator.validate("kvdbEntrySet", example));
    expect(result.success).toBe(false);
});

it("KvdbApiValidator.EntryKeyWithAllowedSpecialCharacters", () => {
    const typesValidator = new KvdbApiValidator(new TypesValidator());
    const example: kvdbApiTypes.KvdbEntrySetModel = {
        kvdbId: "ffghdksghjkdgjdg" as types.kvdb.KvdbId,
        kvdbEntryKey: "4rt45346rtfdg/_:-" as types.kvdb.KvdbEntryKey,
        kvdbEntryValue: "456789y" as types.kvdb.KvdbEntryValue,
        keyId: "dgjhfgjdhghj" as types.core.KeyId,
    };
    const result = Utils.try(() => typesValidator.validate("kvdbEntrySet", example));
    expect(result.success).toBe(true);
});

it("KvdbApiValidator.EntryKeyWithNotAllowedSpecialCharacters", () => {
    const typesValidator = new KvdbApiValidator(new TypesValidator());
    const example: kvdbApiTypes.KvdbEntrySetModel = {
        kvdbId: "ffghdksghjkdgjdg" as types.kvdb.KvdbId,
        kvdbEntryKey: "4rt45346rtfdg/_:-|=" as types.kvdb.KvdbEntryKey,
        kvdbEntryValue: "456789y" as types.kvdb.KvdbEntryValue,
        keyId: "dgjhfgjdhghj" as types.core.KeyId,
    };
    const result = Utils.try(() => typesValidator.validate("kvdbEntrySet", example));
    expect(result.success).toBe(false);
});