import type { ApiTestCase, CorrectionReport, TestcaseSummary, ValidationReport } from "../types";

const BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

type Envelope<T> = { success: true; data: T };
type ErrorEnvelope = { success: false; error: { code: string; message: string; details?: unknown } };

function formatValidationDetails(details: unknown): string {
  if (!details || typeof details !== "object" || !("issues" in details) || !Array.isArray(details.issues)) return "";

  const formatted = details.issues.slice(0, 5).flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const validationIssue = issue as { path?: unknown; message?: unknown };
    if (!Array.isArray(validationIssue.path) || typeof validationIssue.message !== "string") return [];

    const path = validationIssue.path.reduce<string>((result, part, index) => {
      if (typeof part === "number") return `${result}[${part}]`;
      if (typeof part !== "string") return result;
      return `${result}${index > 0 && result ? "." : ""}${part}`;
    }, "");
    return [path ? `${path}: ${validationIssue.message}` : validationIssue.message];
  });

  if (formatted.length === 0) return "";
  const omitted = details.issues.length - formatted.length;
  return ` ${formatted.join("; ")}${omitted > 0 ? `; and ${omitted} more` : ""}`;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json() as Envelope<T> | ErrorEnvelope;
  if (!response.ok || !payload.success) {
    const error = payload as ErrorEnvelope;
    const message = error.error?.message || "Request failed.";
    throw new Error(`${message}${formatValidationDetails(error.error?.details)}`);
  }
  return payload.data;
}

export async function uploadSwagger(file: File) {
  const body = new FormData();
  body.append("file", file);
  return parse<{ sessionId: string; fileName: string; format: string; validationReport: ValidationReport }>(
    await fetch(`${BASE}/swagger/upload`, { method: "POST", body })
  );
}

export async function correctSwagger(sessionId: string, safeOnly = false) {
  return parse<CorrectionReport>(await fetch(`${BASE}/swagger/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, applySafeCorrectionsOnly: safeOnly })
  }));
}

export async function confirmGeneration(sessionId: string) {
  return parse<{ confirmed: true }>(await fetch(`${BASE}/sessions/${sessionId}/confirm-test-generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed: true })
  }));
}

export async function generateTestCases(sessionId: string, categories: string[]) {
  return parse<{ generationSource: string; generationModel?: string; summary: TestcaseSummary; testCases: ApiTestCase[] }>(
    await fetch(`${BASE}/testcases/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, categories })
    })
  );
}

export async function generatePostman(sessionId: string) {
  return parse<{ status: string }>(await fetch(`${BASE}/postman/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, includeBasicTests: true })
  }));
}

export async function clearSession(sessionId: string) {
  return parse<{ status: string }>(await fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" }));
}

export function downloadUrl(sessionId: string, type: "json" | "excel" | "swagger" | "postman") {
  return `${BASE}/sessions/${sessionId}/export/${type}`;
}
