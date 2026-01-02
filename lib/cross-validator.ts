// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cross-Schema Reference Validator (CRIT-004 fix)
 *
 * Validates that references between schemas are valid:
 * - Evidence envelope artifact references
 * - Envelope → Plan references
 * - Plan → Receipt references
 * - Finding → Evidence references
 */

export interface CrossValidationResult {
  valid: boolean;
  errors: CrossReferenceError[];
  warnings: CrossReferenceWarning[];
}

export interface CrossReferenceError {
  type: "missing_reference" | "invalid_reference" | "circular_reference";
  source_schema: string;
  source_id: string;
  target_schema: string;
  target_id: string;
  field: string;
  message: string;
}

export interface CrossReferenceWarning {
  type: "unverified_reference" | "stale_reference";
  message: string;
}

/**
 * Registry of known entities for cross-reference validation
 */
export class EntityRegistry {
  private envelopes = new Map<string, EnvelopeRef>();
  private plans = new Map<string, PlanRef>();
  private receipts = new Map<string, ReceiptRef>();
  private artifacts = new Map<string, ArtifactRef>();

  registerEnvelope(id: string, envelope: EnvelopeRef): void {
    this.envelopes.set(id, envelope);
    // Also register all artifacts from this envelope
    for (const artifact of envelope.artifact_ids) {
      this.artifacts.set(artifact, { envelope_id: id });
    }
  }

  registerPlan(id: string, plan: PlanRef): void {
    this.plans.set(id, plan);
  }

  registerReceipt(id: string, receipt: ReceiptRef): void {
    this.receipts.set(id, receipt);
  }

  hasEnvelope(id: string): boolean {
    return this.envelopes.has(id);
  }

  hasPlan(id: string): boolean {
    return this.plans.has(id);
  }

  hasReceipt(id: string): boolean {
    return this.receipts.has(id);
  }

  hasArtifact(id: string): boolean {
    return this.artifacts.has(id);
  }

  getEnvelope(id: string): EnvelopeRef | undefined {
    return this.envelopes.get(id);
  }

  clear(): void {
    this.envelopes.clear();
    this.plans.clear();
    this.receipts.clear();
    this.artifacts.clear();
  }
}

interface EnvelopeRef {
  artifact_ids: string[];
  parent_envelope_id?: string;
}

interface PlanRef {
  envelope_id?: string;
  receipt_id?: string;
}

interface ReceiptRef {
  plan_id?: string;
  envelope_id?: string;
}

interface ArtifactRef {
  envelope_id: string;
}

/**
 * Validate cross-references within an evidence envelope
 */
export function validateEnvelopeInternalRefs(
  envelope: Record<string, unknown>,
): CrossValidationResult {
  const errors: CrossReferenceError[] = [];
  const warnings: CrossReferenceWarning[] = [];

  const envelopeId = envelope.envelope_id as string;
  const artifacts = (envelope.artifacts as Array<Record<string, unknown>>) || [];
  const findings = (envelope.findings as Array<Record<string, unknown>>) || [];

  // Build set of artifact IDs
  const artifactIds = new Set(
    artifacts.map((a) => a.artifact_id as string).filter(Boolean),
  );

  // Validate finding evidence_refs point to actual artifacts
  for (const finding of findings) {
    const findingId = finding.finding_id as string;
    const evidenceRefs = (finding.evidence_refs as string[]) || [];

    for (const ref of evidenceRefs) {
      if (!artifactIds.has(ref)) {
        errors.push({
          type: "missing_reference",
          source_schema: "evidence-envelope",
          source_id: envelopeId,
          target_schema: "artifact",
          target_id: ref,
          field: `findings[${findingId}].evidence_refs`,
          message: `Finding "${findingId}" references non-existent artifact "${ref}"`,
        });
      }
    }
  }

  // Check for parent envelope reference (can't validate without registry)
  const provenance = envelope.provenance as Record<string, unknown> | undefined;
  if (provenance?.parent_envelope_id) {
    warnings.push({
      type: "unverified_reference",
      message: `Parent envelope "${provenance.parent_envelope_id}" cannot be verified without registry`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate cross-references between related documents
 */
export function validateCrossReferences(
  registry: EntityRegistry,
  documents: {
    envelopes?: Array<Record<string, unknown>>;
    plans?: Array<Record<string, unknown>>;
    receipts?: Array<Record<string, unknown>>;
  },
): CrossValidationResult {
  const errors: CrossReferenceError[] = [];
  const warnings: CrossReferenceWarning[] = [];

  // Register all envelopes
  for (const envelope of documents.envelopes || []) {
    const id = envelope.envelope_id as string;
    const artifacts = (envelope.artifacts as Array<Record<string, unknown>>) || [];
    registry.registerEnvelope(id, {
      artifact_ids: artifacts.map((a) => a.artifact_id as string),
      parent_envelope_id: (envelope.provenance as Record<string, unknown>)
        ?.parent_envelope_id as string | undefined,
    });
  }

  // Register all plans
  for (const plan of documents.plans || []) {
    const id = plan.plan_id as string;
    registry.registerPlan(id, {
      envelope_id: plan.source_envelope_id as string | undefined,
      receipt_id: plan.receipt_id as string | undefined,
    });
  }

  // Register all receipts
  for (const receipt of documents.receipts || []) {
    const id = receipt.receipt_id as string;
    registry.registerReceipt(id, {
      plan_id: receipt.plan_id as string | undefined,
      envelope_id: receipt.envelope_id as string | undefined,
    });
  }

  // Now validate all cross-references

  // Validate envelope → parent envelope
  for (const envelope of documents.envelopes || []) {
    const id = envelope.envelope_id as string;
    const provenance = envelope.provenance as Record<string, unknown> | undefined;
    const parentId = provenance?.parent_envelope_id as string | undefined;

    if (parentId && !registry.hasEnvelope(parentId)) {
      errors.push({
        type: "missing_reference",
        source_schema: "evidence-envelope",
        source_id: id,
        target_schema: "evidence-envelope",
        target_id: parentId,
        field: "provenance.parent_envelope_id",
        message: `Envelope "${id}" references non-existent parent envelope "${parentId}"`,
      });
    }

    // Check for circular reference
    if (parentId === id) {
      errors.push({
        type: "circular_reference",
        source_schema: "evidence-envelope",
        source_id: id,
        target_schema: "evidence-envelope",
        target_id: parentId,
        field: "provenance.parent_envelope_id",
        message: `Envelope "${id}" references itself as parent`,
      });
    }

    // Validate internal refs
    const internalResult = validateEnvelopeInternalRefs(envelope);
    errors.push(...internalResult.errors);
    warnings.push(...internalResult.warnings);
  }

  // Validate plan → envelope
  for (const plan of documents.plans || []) {
    const id = plan.plan_id as string;
    const envelopeId = plan.source_envelope_id as string | undefined;

    if (envelopeId && !registry.hasEnvelope(envelopeId)) {
      errors.push({
        type: "missing_reference",
        source_schema: "procedure-plan",
        source_id: id,
        target_schema: "evidence-envelope",
        target_id: envelopeId,
        field: "source_envelope_id",
        message: `Plan "${id}" references non-existent envelope "${envelopeId}"`,
      });
    }
  }

  // Validate receipt → plan
  for (const receipt of documents.receipts || []) {
    const id = receipt.receipt_id as string;
    const planId = receipt.plan_id as string | undefined;
    const envelopeId = receipt.source_envelope_id as string | undefined;

    if (planId && !registry.hasPlan(planId)) {
      errors.push({
        type: "missing_reference",
        source_schema: "receipt",
        source_id: id,
        target_schema: "procedure-plan",
        target_id: planId,
        field: "plan_id",
        message: `Receipt "${id}" references non-existent plan "${planId}"`,
      });
    }

    if (envelopeId && !registry.hasEnvelope(envelopeId)) {
      errors.push({
        type: "missing_reference",
        source_schema: "receipt",
        source_id: id,
        target_schema: "evidence-envelope",
        target_id: envelopeId,
        field: "source_envelope_id",
        message: `Receipt "${id}" references non-existent envelope "${envelopeId}"`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Quick validation for a single document with a registry
 */
export function validateDocumentRefs(
  registry: EntityRegistry,
  schemaType: "envelope" | "plan" | "receipt",
  document: Record<string, unknown>,
): CrossValidationResult {
  const errors: CrossReferenceError[] = [];
  const warnings: CrossReferenceWarning[] = [];

  switch (schemaType) {
    case "envelope": {
      // Validate internal refs
      const result = validateEnvelopeInternalRefs(document);
      errors.push(...result.errors);
      warnings.push(...result.warnings);

      // Validate parent envelope ref
      const provenance = document.provenance as Record<string, unknown> | undefined;
      const parentId = provenance?.parent_envelope_id as string | undefined;
      if (parentId && !registry.hasEnvelope(parentId)) {
        warnings.push({
          type: "unverified_reference",
          message: `Parent envelope "${parentId}" not in registry`,
        });
      }
      break;
    }

    case "plan": {
      const id = document.plan_id as string;
      const envelopeId = document.source_envelope_id as string | undefined;
      if (envelopeId && !registry.hasEnvelope(envelopeId)) {
        errors.push({
          type: "missing_reference",
          source_schema: "procedure-plan",
          source_id: id,
          target_schema: "evidence-envelope",
          target_id: envelopeId,
          field: "source_envelope_id",
          message: `Plan references non-existent envelope "${envelopeId}"`,
        });
      }
      break;
    }

    case "receipt": {
      const id = document.receipt_id as string;
      const planId = document.plan_id as string | undefined;
      if (planId && !registry.hasPlan(planId)) {
        errors.push({
          type: "missing_reference",
          source_schema: "receipt",
          source_id: id,
          target_schema: "procedure-plan",
          target_id: planId,
          field: "plan_id",
          message: `Receipt references non-existent plan "${planId}"`,
        });
      }
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
