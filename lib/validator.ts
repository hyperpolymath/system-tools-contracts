// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Schema validator for System Tools Contracts
 */

// deno-lint-ignore-file no-explicit-any
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import { loadSchema, type SchemaName } from "../schemas/mod.ts";

// Handle npm module default exports
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    keyword: string;
  }>;
}

/**
 * Create a validator instance with all schemas loaded
 */
export async function createValidator(): Promise<ContractValidator> {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  addFormats(ajv);

  // Load and add all schemas
  const schemaNames: SchemaName[] = [
    "evidenceEnvelope",
    "procedurePlan",
    "receipt",
    "systemWeather",
    "messageIntent",
    "runBundle",
    "packManifest",
    "ambientPayload",
  ];

  for (const name of schemaNames) {
    const schema = await loadSchema(name);
    ajv.addSchema(schema, name);
  }

  return new ContractValidator(ajv);
}

export class ContractValidator {
  private ajv: any;

  constructor(ajv: any) {
    this.ajv = ajv;
  }

  /**
   * Validate data against a named schema
   */
  validate(schemaName: SchemaName, data: unknown): ValidationResult {
    const valid = this.ajv.validate(schemaName, data);

    if (valid) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: this.ajv.errors?.map((err: any) => ({
        path: err.instancePath || "/",
        message: err.message || "Unknown error",
        keyword: err.keyword,
      })),
    };
  }

  /**
   * Validate an Evidence Envelope
   */
  validateEnvelope(data: unknown): ValidationResult {
    return this.validate("evidenceEnvelope", data);
  }

  /**
   * Validate a Procedure Plan
   */
  validatePlan(data: unknown): ValidationResult {
    return this.validate("procedurePlan", data);
  }

  /**
   * Validate a Receipt
   */
  validateReceipt(data: unknown): ValidationResult {
    return this.validate("receipt", data);
  }

  /**
   * Validate a System Weather payload
   */
  validateWeather(data: unknown): ValidationResult {
    return this.validate("systemWeather", data);
  }

  /**
   * Validate a Message Intent
   */
  validateIntent(data: unknown): ValidationResult {
    return this.validate("messageIntent", data);
  }

  /**
   * Validate a Run Bundle manifest
   */
  validateBundle(data: unknown): ValidationResult {
    return this.validate("runBundle", data);
  }

  /**
   * Validate a Pack Manifest
   */
  validatePack(data: unknown): ValidationResult {
    return this.validate("packManifest", data);
  }

  /**
   * Validate an Ambient Payload
   */
  validateAmbient(data: unknown): ValidationResult {
    return this.validate("ambientPayload", data);
  }
}
