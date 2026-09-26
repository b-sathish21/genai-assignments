import { ZodError } from "zod";
import type { ApiTestCase, JsonObject, TestCaseCategory } from "../types/index.js";
import { TestCaseOutputSchema } from "../schemas/llm.schemas.js";
import { callLlmJson, isLlmEnabled } from "./llm.service.js";
import { TEST_CASE_SYSTEM_PROMPT } from "./prompts.js";
import { env } from "../config/environment.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

function deduplicate(cases: ApiTestCase[]): ApiTestCase[] {
  const seen = new Set<string>();
  return cases.filter((testCase) => {
    const key = `${testCase.method}|${testCase.endpoint}|${testCase.category}|${testCase.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PRIORITY_RANK: Record<ApiTestCase["priority"], number> = { High: 0, Medium: 1, Low: 2 };

// Round-robins across categories (highest priority first within each) so the cap
// spreads across positive/negative/boundary/etc. instead of one category eating the
// whole budget. Cases within a category stay in spec order, which already alternates
// across endpoints, so endpoint coverage stays broad too.
function limitTestCases(cases: ApiTestCase[], max: number): ApiTestCase[] {
  if (cases.length <= max) return cases;

  const groups = new Map<string, ApiTestCase[]>();
  for (const testCase of cases) {
    const group = groups.get(testCase.category);
    if (group) group.push(testCase);
    else groups.set(testCase.category, [testCase]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }

  const groupList = [...groups.values()];
  const selected: ApiTestCase[] = [];
  for (let round = 0; selected.length < max && round < Math.max(...groupList.map((g) => g.length)); round++) {
    for (const group of groupList) {
      if (selected.length >= max) break;
      if (round < group.length) selected.push(group[round]);
    }
  }
  return selected;
}

function renumber(cases: ApiTestCase[]): ApiTestCase[] {
  return cases.map((testCase, index) => ({ ...testCase, testCaseId: `TC-API-${String(index + 1).padStart(3, "0")}` }));
}

async function llmCases(specification: JsonObject, categories: TestCaseCategory[]) {
  const system = TEST_CASE_SYSTEM_PROMPT;
  const user = JSON.stringify({ categories, specification });
  const output = await callLlmJson(system, user);
  try {
    return TestCaseOutputSchema.parse(output).testCases;
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;

    const issues = error.issues.slice(0, 20).map(({ path, message }) => ({ path, message }));
    logger.warn({ issues }, "LLM output did not match the test-case schema; requesting one correction.");

    const repairSystem = [
      TEST_CASE_SYSTEM_PROMPT,
      "The previous response failed schema validation. Return the complete corrected JSON object, not just the changed cases.",
      "Preserve valid test cases and values. Correct the reported fields using only the supplied OpenAPI specification.",
      "Do not guess undocumented status codes or expected behavior. Omit a case if it cannot be grounded in the specification."
    ].join("\n");
    const repairUser = JSON.stringify({ categories, specification, invalidOutput: output, validationIssues: issues });
    const repairedOutput = await callLlmJson(repairSystem, repairUser);

    try {
      return TestCaseOutputSchema.parse(repairedOutput).testCases;
    } catch (repairError) {
      if (!(repairError instanceof ZodError)) throw repairError;

      const repairIssues = repairError.issues.slice(0, 20).map(({ path, message }) => ({ path, message }));
      logger.error({ issues: repairIssues }, "Corrected LLM output still did not match the test-case schema.");
      throw new AppError(
        502,
        "LLM_OUTPUT_INVALID",
        "The LLM response still did not match the required schema after one correction attempt.",
        { issues: repairIssues }
      );
    }
  }
}

function finalize(cases: ApiTestCase[]): ApiTestCase[] {
  return renumber(limitTestCases(deduplicate(cases), env.MAX_TEST_CASES));
}

// Test cases are generated exclusively by the configured LLM. There is intentionally no
// hardcoded/deterministic fallback: if the provider is not configured or the request fails,
// generation errors out so the application never returns non-LLM results.
export async function generateTestCases(specification: JsonObject, categories: TestCaseCategory[]) {
  if (!isLlmEnabled()) {
    throw new AppError(
      503,
      "LLM_NOT_CONFIGURED",
      "Inception Labs is not configured. Set INCEPTION_API_KEY and INCEPTION_MODEL in the backend .env to generate test cases."
    );
  }

  const generated = await llmCases(specification, categories);
  if (generated.length === 0) {
    throw new AppError(502, "LLM_EMPTY_RESULT", "The LLM returned no test cases for the supplied specification.");
  }

  logger.info({ count: generated.length, model: env.INCEPTION_MODEL }, "Generated test cases with Inception Labs.");
  return { testCases: finalize(generated), source: "inception" as const, model: env.INCEPTION_MODEL };
}

export function summarizeTestCases(testCases: ApiTestCase[]) {
  const counts = Object.fromEntries([
    "positive", "negative", "boundary", "authentication", "authorization", "validation", "error-handling"
  ].map((category) => [category, testCases.filter((testCase) => testCase.category === category).length]));
  return { totalTestCases: testCases.length, ...counts };
}
