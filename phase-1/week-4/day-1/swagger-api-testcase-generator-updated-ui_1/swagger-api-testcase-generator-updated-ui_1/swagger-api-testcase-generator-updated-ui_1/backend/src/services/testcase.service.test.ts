import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestCaseCategory } from "../types/index.js";

const { callLlmJson, isLlmEnabled } = vi.hoisted(() => ({
  callLlmJson: vi.fn(),
  isLlmEnabled: vi.fn(() => true)
}));

vi.mock("./llm.service.js", () => ({ callLlmJson, isLlmEnabled }));

import { generateTestCases } from "./testcase.service.js";

describe("generateTestCases", () => {
  beforeEach(() => {
    callLlmJson.mockReset();
    isLlmEnabled.mockReturnValue(true);
  });

  it("retries incomplete LLM output with its schema issues", async () => {
    const categories: TestCaseCategory[] = ["positive"];
    const invalidCase = {
      testCaseId: "TC-API-001",
      endpoint: "/pets",
      method: "GET",
      category: "positive",
      title: "List pets",
      priority: "High",
      preconditions: [],
      headers: {},
      pathParameters: {}
    };
    const correctedCase = {
      ...invalidCase,
      queryParameters: {},
      steps: ["Send a GET request to /pets."],
      expectedStatusCode: 200,
      expectedResult: "The API returns the documented pet list.",
      sourceReferences: ["paths./pets.get"]
    };
    callLlmJson
      .mockResolvedValueOnce({ testCases: [invalidCase] })
      .mockResolvedValueOnce({ testCases: [correctedCase] });

    const result = await generateTestCases({ openapi: "3.0.0", paths: {} }, categories);

    expect(callLlmJson).toHaveBeenCalledTimes(2);
    expect(callLlmJson.mock.calls[1][0]).toContain("previous response failed schema validation");
    const repairPayload = JSON.parse(callLlmJson.mock.calls[1][1]) as {
      validationIssues: Array<{ path: Array<string | number> }>;
    };
    expect(repairPayload.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["testCases", 0, "queryParameters"] }),
      expect.objectContaining({ path: ["testCases", 0, "steps"] }),
      expect.objectContaining({ path: ["testCases", 0, "expectedStatusCode"] }),
      expect.objectContaining({ path: ["testCases", 0, "expectedResult"] }),
      expect.objectContaining({ path: ["testCases", 0, "sourceReferences"] })
    ]));
    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].expectedStatusCode).toBe(200);
  });
});