import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "fs";
import type { ValidateFunction, ErrorObject } from "ajv";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export function loadSchema(schemaPath: string): ValidateFunction {
    const json = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    // Ajv2020#compile の戻り値を型付け
    return ajv.compile(json) as ValidateFunction;
}

export function assertValid<T>(
    validate: ValidateFunction,
    data: unknown
): asserts data is T {
    const ok = validate(data);
    if (!ok) {
        const msg = (validate.errors ?? [])
            .map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message}`)
            .join("; ");
        const err = new Error(`Schema validation failed: ${msg}`) as Error & {
            errors?: ErrorObject[] | null;
        };
        err.errors = validate.errors ?? null;
        throw err;
    }
}
