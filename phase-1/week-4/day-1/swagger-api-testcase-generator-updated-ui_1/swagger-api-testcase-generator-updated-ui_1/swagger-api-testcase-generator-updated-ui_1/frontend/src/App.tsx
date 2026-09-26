import { useState } from "react";
import { LeafLogo } from "./components/LeafLogo";
import { UploadPanel } from "./components/UploadPanel";
import { ValidationPanel } from "./components/ValidationPanel";
import { TestcasePanel } from "./components/TestcasePanel";
import type {
  ApiTestCase,
  CorrectionReport,
  TestcaseSummary,
  ValidationReport,
} from "./types";
import {
  clearSession,
  confirmGeneration,
  correctSwagger,
  downloadUrl,
  generatePostman,
  generateTestCases,
  uploadSwagger,
} from "./services/api";

const categories = [
  "positive",
  "negative",
  "boundary",
  "authentication",
  "authorization",
  "validation",
  "error-handling",
];

type InputMode = "file" | "url";

export default function App() {
  const [sessionId, setSessionId] = useState<string>();
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [swaggerUrl, setSwaggerUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [validation, setValidation] = useState<ValidationReport>();
  const [correction, setCorrection] = useState<CorrectionReport>();
  const [testCases, setTestCases] = useState<ApiTestCase[]>([]);
  const [summary, setSummary] = useState<TestcaseSummary>();
  const [generationSource, setGenerationSource] = useState("");
  const [generationModel, setGenerationModel] = useState("");
  const [postmanReady, setPostmanReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  }>();

  const resetLocal = () => {
    setSessionId(undefined);
    setInputMode("file");
    setSwaggerUrl("");
    setFileName("");
    setValidation(undefined);
    setCorrection(undefined);
    setTestCases([]);
    setSummary(undefined);
    setGenerationSource("");
    setGenerationModel("");
    setPostmanReady(false);
    setNotice(undefined);
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const data = await uploadSwagger(file);
      setSessionId(data.sessionId);
      setFileName(data.fileName);
      setValidation(data.validationReport);
      setCorrection(undefined);
      setTestCases([]);
      setSummary(undefined);
      setNotice({
        type: data.validationReport.isValid ? "success" : "error",
        text: data.validationReport.isValid
          ? "Swagger uploaded and validated successfully."
          : "Swagger uploaded. Review and correct the validation errors.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Upload failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUrlValidate = async () => {
    const trimmedUrl = swaggerUrl.trim();
    if (!trimmedUrl) {
      setNotice({ type: "error", text: "Please enter a valid Swagger URL." });
      return;
    }

    try {
      const response = await fetch(trimmedUrl);
      if (!response.ok) {
        throw new Error(
          `Unable to fetch the Swagger definition. Server responded with status ${response.status}.`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const blob = await response.blob();
      const lowerUrl = trimmedUrl.toLowerCase();
      const guessedFormat =
        lowerUrl.endsWith(".json") || contentType.includes("json")
          ? "json"
          : "yaml";
      const fileName =
        trimmedUrl.split("/").filter(Boolean).pop() ||
        `swagger-spec.${guessedFormat}`;
      const file = new File([blob], fileName, {
        type:
          contentType ||
          (guessedFormat === "json" ? "application/json" : "application/yaml"),
      });

      setSwaggerUrl("");
      await handleUpload(file);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The Swagger URL could not be fetched.";

      setNotice({
        type: "error",
        text:
          message.includes("CORS") || message.includes("Failed to fetch")
            ? "Unable to fetch the Swagger URL. Please make sure the URL is public and CORS-enabled, or switch to File mode."
            : message,
      });
    }
  };

  const handleCorrect = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await correctSwagger(sessionId);
      setCorrection(result);
      setValidation((current) =>
        current
          ? {
              ...current,
              isValid: result.isCorrectedSpecificationValid,
              errorCount: result.remainingErrors.length,
              errors: result.remainingErrors,
            }
          : current,
      );
      setNotice({
        type: result.isCorrectedSpecificationValid ? "success" : "error",
        text: result.isCorrectedSpecificationValid
          ? `Swagger corrected using ${result.source}.`
          : "Some validation errors remain after correction.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Correction failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await confirmGeneration(sessionId);
      const result = await generateTestCases(sessionId, categories);
      setTestCases(result.testCases);
      setSummary(result.summary);
      setGenerationSource(result.generationSource);
      setGenerationModel(result.generationModel ?? "");
      setNotice({
        type: "success",
        text: `${result.summary.totalTestCases} API testcases generated.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Testcase generation failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePostman = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await generatePostman(sessionId);
      setPostmanReady(true);
      setNotice({
        type: "success",
        text: "Postman collection generated and ready to download.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "Postman generation failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = (type: "json" | "excel" | "swagger" | "postman") => {
    if (!sessionId) return;
    window.location.assign(downloadUrl(sessionId, type));
  };

  const handleClear = async () => {
    if (sessionId) {
      try {
        await clearSession(sessionId);
      } catch {
        /* Local state should still be reset. */
      }
    }
    resetLocal();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <LeafLogo />
        <div className="topbar-actions">
          <button
            className="button ghost"
            type="button"
            disabled={!sessionId || busy}
            onClick={handleClear}
          >
            Clear
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Swagger → Quality Test Coverage</span>
            <h2>
              Generate{" "}
              <mark className="hl hl-green">reliable API testcases</mark> from{" "}
              <mark className="hl hl-blue">Swagger</mark>
            </h2>
            <p>
              Upload, validate, generate, review, and export — through one
              controlled Testleaf-themed workflow.
            </p>
            <div className="hero-badges">
              <span className="hero-badge">⚡ AI-powered</span>
              <span className="hero-badge">✓ Spec-grounded</span>
              <span className="hero-badge">↓ Postman &amp; Excel export</span>
            </div>
          </div>
          <ol className="flow-rail" aria-label="Application flow">
            {[
              ["01", "Upload"],
              ["02", "Validate"],
              ["03", "Generate"],
              ["04", "Export"],
            ].map(([number, label], index) => (
              <li className="flow-step" key={number}>
                <span>{number}</span>
                <strong>{label}</strong>
                {index < 2 && <i />}
              </li>
            ))}
          </ol>
        </section>

        {notice && (
          <div className={`notice ${notice.type}`} role="status">
            {notice.text}
          </div>
        )}

        {!sessionId && (
          <UploadPanel
            busy={busy}
            onUpload={handleUpload}
            onClear={handleClear}
            visible={!!sessionId}
            inputMode={inputMode}
            onInputModeChange={(mode) => {
              setInputMode(mode);
              if (mode === "file") setSwaggerUrl("");
            }}
            swaggerUrl={swaggerUrl}
            onSwaggerUrlChange={setSwaggerUrl}
            onUrlValidate={handleUrlValidate}
            onUrlClear={() => setSwaggerUrl("")}
          />
        )}

        {sessionId && validation && !summary && (
          <ValidationPanel
            fileName={fileName}
            report={validation}
            correction={correction}
            busy={busy}
            onCorrect={handleCorrect}
            onGenerate={handleGenerate}
            onClear={handleClear}
            visible={(validation.errors?.length ?? 0) > 0}
          />
        )}

        {sessionId && summary && (
          <TestcasePanel
            testCases={testCases}
            summary={summary}
            generationSource={generationSource}
            generationModel={generationModel}
            onDownload={handleDownload}
            onGeneratePostman={handlePostman}
            postmanReady={postmanReady}
            busy={busy}
            onClear={handleClear}
            visible={!!summary}
          />
        )}
      </main>

      <footer>
        <span>
          © 2026 Testleaf Software Solutions Pvt. Ltd. All rights reserved.
        </span>
      </footer>
    </div>
  );
}
