import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";
import type { JsonObject, ValidationIssue, ValidationReport } from "../types/index.js";
import { AppError } from "../utils/errors.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

export function parseSpecification(fileName: string, content: Buffer): {
  format: "yaml" | "json";
  specification: JsonObject;
} {
  const text = content.toString("utf-8").trim();
  if (!text) throw new AppError(400, "EMPTY_FILE", "The uploaded file is empty.");

  try {
    const format = fileName.toLowerCase().endsWith(".json") ? "json" : "yaml";
    const parsed = format === "json" ? JSON.parse(text) : YAML.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The root document must be an object.");
    }
    return { format, specification: parsed as JsonObject };
  } catch (error) {
    const code = fileName.toLowerCase().endsWith(".json") ? "INVALID_JSON" : "INVALID_YAML";
    throw new AppError(400, code, `The uploaded ${code === "INVALID_JSON" ? "JSON" : "YAML"} cannot be parsed.`, {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizeParserError(error: unknown): ValidationIssue[] {
  const message = error instanceof Error ? error.message : String(error);
  const pathMatch = message.match(/at\s+([\w./\[\]-]+)/i);
  return [{
    code: "OPENAPI_SCHEMA_ERROR",
    path: pathMatch?.[1] ?? "$",
    message,
    severity: "error"
  }];
}

function collectWarnings(specification: JsonObject): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const paths = specification.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    warnings.push({ code: "NO_PATHS", path: "paths", message: "The specification contains no API paths.", severity: "warning" });
    return warnings;
  }

  for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationObject = operation as Record<string, unknown>;
      if (!operationObject.operationId) {
        warnings.push({
          code: "MISSING_OPERATION_ID",
          path: `paths.${path}.${method}`,
          message: "Operation ID is recommended for stable testcase traceability.",
          severity: "warning"
        });
      }
      if (!operationObject.summary && !operationObject.description) {
        warnings.push({
          code: "MISSING_OPERATION_DESCRIPTION",
          path: `paths.${path}.${method}`,
          message: "Operation summary or description is recommended.",
          severity: "warning"
        });
      }
    }
  }
  return warnings;
}

export async function validateSpecification(specification: JsonObject): Promise<ValidationReport> {
  let errors: ValidationIssue[] = [];
  try {
    await SwaggerParser.validate(structuredClone(specification) as never);
  } catch (error) {
    errors = normalizeParserError(error);
  }

  const warnings = collectWarnings(specification);
  const version = typeof specification.openapi === "string"
    ? specification.openapi
    : typeof specification.swagger === "string"
      ? specification.swagger
      : undefined;

  return {
    isValid: errors.length === 0,
    openApiVersion: version,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings
  };
}

export function serializeSpecification(specification: JsonObject, format: "yaml" | "json"): string {
  return format === "json"
    ? JSON.stringify(specification, null, 2)
    : YAML.stringify(specification, { indent: 2 });
}

export function getSpecificationSummary(specification: JsonObject) {
  const info = (specification.info && typeof specification.info === "object")
    ? specification.info as Record<string, unknown>
    : {};
  const paths = (specification.paths && typeof specification.paths === "object")
    ? specification.paths as Record<string, unknown>
    : {};
  let totalOperations = 0;
  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    totalOperations += METHODS.filter((method) => Boolean((pathItem as Record<string, unknown>)[method])).length;
  }
  const components = specification.components && typeof specification.components === "object"
    ? specification.components as Record<string, unknown>
    : {};
  const securitySchemes = components.securitySchemes && typeof components.securitySchemes === "object"
    ? Object.keys(components.securitySchemes as Record<string, unknown>).length
    : 0;

  return {
    title: typeof info.title === "string" ? info.title : "Untitled API",
    version: typeof info.version === "string" ? info.version : "Not specified",
    openApiVersion: typeof specification.openapi === "string" ? specification.openapi : specification.swagger,
    totalPaths: Object.keys(paths).length,
    totalOperations,
    securitySchemes
  };
}
