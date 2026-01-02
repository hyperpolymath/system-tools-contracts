// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Schema exports for System Tools Contracts
 */

// Schema file paths for dynamic loading
export const SCHEMA_FILES = {
  evidenceEnvelope: "./evidence-envelope.schema.json",
  procedurePlan: "./procedure-plan.schema.json",
  receipt: "./receipt.schema.json",
  systemWeather: "./system-weather.schema.json",
  messageIntent: "./message-intent.schema.json",
  runBundle: "./run-bundle.schema.json",
  packManifest: "./pack-manifest.schema.json",
  ambientPayload: "./ambient-payload.schema.json",
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

/**
 * Load a schema by name
 */
export async function loadSchema(name: SchemaName): Promise<unknown> {
  const path = new URL(SCHEMA_FILES[name], import.meta.url);
  const text = await Deno.readTextFile(path);
  return JSON.parse(text);
}

/**
 * Load all schemas
 */
export async function loadAllSchemas(): Promise<Record<SchemaName, unknown>> {
  const schemas: Partial<Record<SchemaName, unknown>> = {};
  for (const name of Object.keys(SCHEMA_FILES) as SchemaName[]) {
    schemas[name] = await loadSchema(name);
  }
  return schemas as Record<SchemaName, unknown>;
}
