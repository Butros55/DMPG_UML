import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchSourceCode, openInIde, type SourceCodeResult, type IdeName } from "../api";

interface SourceViewerProps {
  symbolId: string;
  symbolLabel: string;
  onClose: () => void;
}

/* ══════════════════════════════════════════════════════
   Lightweight syntax highlighter — VS Code Dark+ colors
   ══════════════════════════════════════════════════════ */

interface Token { text: string; cls: string }

/* ── Python rules ─────────────────────────────────── */

const PY_KEYWORDS = new Set([
  "False","None","True","and","as","assert","async","await","break","class",
  "continue","def","del","elif","else","except","finally","for","from","global",
  "if","import","in","is","lambda","nonlocal","not","or","pass","raise",
  "return","try","while","with","yield",
]);

const PY_BUILTINS = new Set([
  "print","len","range","int","str","float","list","dict","set","tuple",
  "bool","type","isinstance","issubclass","super","enumerate","zip","map",
  "filter","sorted","reversed","open","hasattr","getattr","setattr","delattr",
  "callable","staticmethod","classmethod","property","abs","max","min","sum",
  "any","all","round","id","hex","oct","bin","chr","ord","repr","hash","next","iter",
  "ValueError","TypeError","KeyError","IndexError","RuntimeError","Exception",
  "StopIteration","AttributeError","ImportError","OSError","FileNotFoundError",
  "NotImplementedError","ZeroDivisionError",
]);

/**
 * Regex-based tokenizer for Python.
 * Each branch captures one token type; order matters.
 */
const PY_TOKEN_RE = new RegExp(
  [
    `("""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, // strings
    `(#[^\\n]*)`,                                           // comment
    `(@\\w+)`,                                              // decorator
    `(\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?j?\\b)`,           // number
    `(\\b[A-Za-z_]\\w*(?=\\s*\\())`,                        // function call
    `(\\b[A-Za-z_]\\w*\\b)`,                                // identifier / keyword
    `([{}()\\[\\]:;,\\.=<>+\\-*/%&|^~!@])`,                 // punctuation
  ].join("|"),
  "g",
);

function tokenizePython(line: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  PY_TOKEN_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = PY_TOKEN_RE.exec(line)) !== null) {
    // Plain text before match
    if (m.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, m.index), cls: "" });
    }
    if (m[1]) {
      tokens.push({ text: m[0], cls: "tok-string" });
    } else if (m[2]) {
      tokens.push({ text: m[0], cls: "tok-comment" });
    } else if (m[3]) {
      tokens.push({ text: m[0], cls: "tok-decorator" });
    } else if (m[4]) {
      tokens.push({ text: m[0], cls: "tok-number" });
    } else if (m[5]) {
      // function call — but might also be a keyword like `def`, `class`, `if`
      if (PY_KEYWORDS.has(m[0])) {
        tokens.push({ text: m[0], cls: "tok-keyword" });
      } else if (PY_BUILTINS.has(m[0])) {
        tokens.push({ text: m[0], cls: "tok-builtin" });
      } else {
        tokens.push({ text: m[0], cls: "tok-function" });
      }
    } else if (m[6]) {
      // identifier
      if (PY_KEYWORDS.has(m[0])) {
        tokens.push({ text: m[0], cls: "tok-keyword" });
      } else if (PY_BUILTINS.has(m[0])) {
        tokens.push({ text: m[0], cls: "tok-builtin" });
      } else if (/^[A-Z]/.test(m[0])) {
        tokens.push({ text: m[0], cls: "tok-type" });
      } else if (m[0] === "self" || m[0] === "cls") {
        tokens.push({ text: m[0], cls: "tok-self" });
      } else {
        tokens.push({ text: m[0], cls: "" });
      }
    } else if (m[7]) {
      tokens.push({ text: m[0], cls: "tok-punct" });
    } else {
      tokens.push({ text: m[0], cls: "" });
    }
    lastIndex = PY_TOKEN_RE.lastIndex;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), cls: "" });
  }
  return tokens;
}

/* ── Generic / fallback tokenizer (minimal) ────── */
function tokenizeFallback(line: string): Token[] {
  return [{ text: line, cls: "" }];
}

/** Pick tokenizer based on language string from server. */
function tokenizeLine(line: string, language: string): Token[] {
  if (language === "python") return tokenizePython(line);
  return tokenizeFallback(line);
}

/* ══════════════════════════════════════════════════════
   Source Viewer component
   ══════════════════════════════════════════════════════ */

/**
 * Floating popup that shows the source code for a given symbol.
 * Designed as a modal overlay, not inline in the inspector.
 */
export function SourceViewer({ symbolId, symbolLabel, onClose }: SourceViewerProps) {
  const [result, setResult] = useState<SourceCodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ideStatus, setIdeStatus] = useState<string | null>(null);
  const [ideMenuOpen, setIdeMenuOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const ideMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchSourceCode(symbolId)
      .then((r) => { setResult(r); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [symbolId]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close IDE menu on outside click
  useEffect(() => {
    if (!ideMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (ideMenuRef.current && !ideMenuRef.current.contains(e.target as Node)) {
        setIdeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ideMenuOpen]);

  // Close on overlay click (outside content)
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const handleOpenInIde = useCallback(
    async (ide: IdeName) => {
      if (!result) return;
      setIdeMenuOpen(false);
      setIdeStatus(`Öffne in ${ide === "vscode" ? "VS Code" : "IntelliJ"}…`);
      try {
        await openInIde(ide, result.file, result.startLine);
        setIdeStatus(`\u2705 Ge\u00f6ffnet in ${ide === "vscode" ? "VS Code" : "IntelliJ"}`);
        setTimeout(() => setIdeStatus(null), 2500);
      } catch (err: any) {
        setIdeStatus(`\u26a0\ufe0f ${err.message}`);
        setTimeout(() => setIdeStatus(null), 4000);
      }
    },
    [result],
  );

  // Pre-tokenize all lines once
  const highlightedLines = useMemo(() => {
    if (!result) return [];
    const lang = result.language ?? "text";
    return result.code.split("\n").map((line) => tokenizeLine(line, lang));
  }, [result]);

  return (
    <div className="source-viewer-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="source-viewer-panel">
        {/* Header */}
        <div className="source-viewer-header">
          <div className="source-viewer-title">
            <span className="source-viewer-icon"><i className="bi bi-code-square" /></span>
            <span className="source-viewer-name">{symbolLabel}</span>
            {result && (
              <span className="source-viewer-location">
                {result.file}:{result.startLine}-{result.endLine}
              </span>
            )}
          </div>
          <div className="source-viewer-actions">
            {/* Open in IDE dropdown */}
            {result && (
              <div className="sv-ide-dropdown" ref={ideMenuRef}>
                <button
                  className="sv-ide-btn"
                  onClick={() => setIdeMenuOpen((o) => !o)}
                  title="In IDE öffnen"
                >
                  <i className="bi bi-box-arrow-up-right" /> In IDE öffnen
                </button>
                {ideMenuOpen && (
                  <div className="sv-ide-menu">
                    <button className="sv-ide-menu-item" onClick={() => handleOpenInIde("vscode")}>
                      <span className="sv-ide-menu-icon"><i className="bi bi-window" /></span> VS Code
                    </button>
                    <button className="sv-ide-menu-item" onClick={() => handleOpenInIde("intellij")}>
                      <span className="sv-ide-menu-icon"><i className="bi bi-braces" /></span> IntelliJ IDEA
                    </button>
                  </div>
                )}
              </div>
            )}
            {ideStatus && <span className="sv-ide-status">{ideStatus}</span>}
            <button className="source-viewer-close" onClick={onClose} title="Schließen (Esc)"><i className="bi bi-x-lg" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="source-viewer-body">
          {loading && <div className="source-viewer-loading">Lade Quellcode…</div>}
          {error && <div className="source-viewer-error"><i className="bi bi-exclamation-triangle" /> {error}</div>}
          {result && (
            <div className="source-viewer-code-wrap">
              <pre className="source-viewer-code">
                <code>{highlightedLines.map((tokens, i) => (
                  <div key={i} className="source-line">
                    <span className="source-line-num">{result.startLine + i}</span>
                    <span className="source-line-text">
                      {tokens.map((t, j) =>
                        t.cls
                          ? <span key={j} className={t.cls}>{t.text}</span>
                          : <span key={j}>{t.text}</span>
                      )}
                    </span>
                  </div>
                ))}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
