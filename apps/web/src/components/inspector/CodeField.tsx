"use client";

import Editor, { loader, useMonaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  language: "prompt" | "python" | "json";
  height?: number;
  placeholder?: string;
};

let promptLangRegistered = false;
if (typeof window !== "undefined") loader.init().catch(() => {});

/** Monaco with a tiny "prompt" language that highlights {{variables}}. */
export function CodeField({ value, onChange, language, height = 120 }: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    if (!monaco || promptLangRegistered) return;
    promptLangRegistered = true;
    monaco.languages.register({ id: "prompt" });
    monaco.languages.setMonarchTokensProvider("prompt", {
      tokenizer: { root: [[/\{\{\s*[a-zA-Z_][\w.]*\s*\}\}/, "variable"]] },
    });
    monaco.editor.defineTheme("studio", {
      base: "vs-dark",
      inherit: true,
      rules: [{ token: "variable", foreground: "7dd3fc", fontStyle: "bold" }],
      colors: { "editor.background": "#0b0d12", "editorLineNumber.foreground": "#3b4252", "editor.lineHighlightBackground": "#12151c" },
    });
  }, [monaco]);

  return (
    <div className="overflow-hidden rounded-md border border-edge focus-within:border-sky-500/60">
      <Editor
        height={height}
        language={language}
        theme="studio"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={(ed) => {
          editorRef.current = ed;
        }}
        options={{
          minimap: { enabled: false },
          lineNumbers: language === "python" ? "on" : "off",
          fontSize: 12,
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: language === "python" ? 8 : 0,
          lineNumbersMinChars: 3,
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { vertical: "auto", horizontal: "hidden", verticalScrollbarSize: 6 },
          padding: { top: 8, bottom: 8 },
          tabSize: 4,
          automaticLayout: true,
        }}
        loading={<div className="h-full bg-canvas" style={{ height }} />}
      />
    </div>
  );
}
