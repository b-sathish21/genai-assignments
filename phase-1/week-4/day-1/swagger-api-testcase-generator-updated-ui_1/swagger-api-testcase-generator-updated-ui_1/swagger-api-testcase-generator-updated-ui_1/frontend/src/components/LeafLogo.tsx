import logoUrl from "../../assets/testleaf-logo.svg";

export function LeafLogo() {
  return (
    <div className="brand" aria-label="Testleaf API Testcase Generator">
      <img className="brand-logo" src={logoUrl} alt="Testleaf" />
      <span className="brand-divider" aria-hidden="true" />
      <span className="brand-sub">API Testcase Generator</span>
    </div>
  );
}
