import { useRef, useState } from "react";

type InputMode = "file" | "url";

export function UploadPanel({
  busy,
  onUpload,
  onClear,
  visible,
  inputMode = "file",
  onInputModeChange,
  swaggerUrl = "",
  onSwaggerUrlChange,
  onUrlValidate,
  onUrlClear,
}: {
  busy: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
  visible: boolean;
  inputMode?: InputMode;
  onInputModeChange?: (mode: InputMode) => void;
  swaggerUrl?: string;
  onSwaggerUrlChange?: (value: string) => void;
  onUrlValidate?: () => void;
  onUrlClear?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onUpload(file);
  };

  return (
    <section className="card upload-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Step 1</span>
          <h2>
            Upload <mark className="hl hl-green">Swagger</mark> specification
          </h2>
          <p>
            {inputMode === "file"
              ? "Choose an OpenAPI YAML, YML, or JSON file."
              : "Paste a public Swagger URL to validate and continue."}
          </p>
        </div>
        {visible && (
          <button className="button ghost" type="button" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div
        className="input-mode-toggle"
        role="radiogroup"
        aria-label="Swagger input type"
      >
        <label
          className={`mode-option ${inputMode === "file" ? "active" : ""}`}
        >
          <input
            type="radio"
            name="swagger-input-type"
            checked={inputMode === "file"}
            onChange={() => onInputModeChange?.("file")}
            disabled={busy}
          />
          <span>File</span>
        </label>

        <label className={`mode-option ${inputMode === "url" ? "active" : ""}`}>
          <input
            type="radio"
            name="swagger-input-type"
            checked={inputMode === "url"}
            onChange={() => onInputModeChange?.("url")}
            disabled={busy}
          />
          <span>URL</span>
        </label>
      </div>

      {inputMode === "file" ? (
        <>
          <button
            type="button"
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files);
            }}
            disabled={busy}
          >
            <span className="upload-icon" aria-hidden="true">
              ↑
            </span>
            <strong>
              {busy
                ? "Processing specification…"
                : "Drop your Swagger file here"}
            </strong>
            <span>or click to browse</span>
            <small>Maximum 5 MB · .yaml · .yml · .json</small>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".yaml,.yml,.json,application/json,application/yaml"
            hidden
            onChange={(e) => accept(e.target.files)}
          />
        </>
      ) : (
        <div className="url-panel">
          <label className="url-input-label" htmlFor="swagger-url">
            Swagger URL
          </label>
          <input
            id="swagger-url"
            type="url"
            className="url-input"
            value={swaggerUrl}
            onChange={(event) => onSwaggerUrlChange?.(event.target.value)}
            placeholder="https://example.com/swagger.yaml"
            disabled={busy}
          />
          <div className="url-input-hint">
            Use a public Swagger URL. The browser must be allowed to fetch it
            (CORS enabled).
          </div>
          <div className="url-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy || !swaggerUrl.trim()}
              onClick={onUrlValidate}
            >
              Validate
            </button>
            <button
              className="button ghost"
              type="button"
              disabled={busy}
              onClick={onUrlClear}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
