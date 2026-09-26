import { env, llmEnabled } from "../config/environment.js";
import { AppError } from "../utils/errors.js";

export function isLlmEnabled(): boolean {
  return llmEnabled;
}

export async function callLlmJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
  if (!llmEnabled || !env.INCEPTION_API_KEY || !env.INCEPTION_MODEL) {
    throw new AppError(503, "LLM_NOT_CONFIGURED", "Inception Labs is not configured on the backend.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.INCEPTION_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.INCEPTION_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.INCEPTION_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.INCEPTION_MODEL,
        temperature: 0.5,
        max_completion_tokens: env.INCEPTION_MAX_COMPLETION_TOKENS,
        ...(env.INCEPTION_REASONING_EFFORT ? { reasoning_effort: env.INCEPTION_REASONING_EFFORT } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // Keep the raw response snippet when the provider does not return JSON.
      }
      throw new AppError(
        response.status,
        "INCEPTION_REQUEST_FAILED",
        `Inception Labs request failed (HTTP ${response.status}): ${detail}`,
        { status: response.status, body: body.slice(0, 1000) }
      );
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AppError(502, "INCEPTION_EMPTY_RESPONSE", "Inception Labs returned an empty response.");

    try {
      return JSON.parse(content);
    } catch {
      throw new AppError(502, "INCEPTION_INVALID_JSON", "Inception Labs did not return valid JSON.", { content: content.slice(0, 1000) });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(504, "INCEPTION_TIMEOUT", "Inception Labs request timed out.");
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(502, "INCEPTION_REQUEST_FAILED", `Inception Labs request failed: ${reason}`, { reason });
  } finally {
    clearTimeout(timeout);
  }
}