import { AssertionError } from "assert";

export function expect(actual: unknown) {
    let theContext: string|undefined;
    const obj = {
        toBe: (expected: unknown) => {
            if (actual !== expected) {
                throw new AssertionError({message: theContext, actual, expected, operator: "==="});
            }
        },
        withContext: (context: string) => {
            theContext = context;
            return obj;
        },
    };
    return obj;
}
