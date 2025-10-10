import { DivvunAPI } from "./api.ts";
import type {
  SupportedLanguage,
  DivvunError,
  EditorState,
  GrammarCheckerConfig,
} from "./types.ts";

// Quill types are not shipped with Deno by default; use any to avoid type issues in this small app
// Minimal Quill typings we need (Quill is loaded via CDN in the page)
// Use the runtime bridge created in src/quill-bridge.js (exposes `globalThis.QuillBridge`)
interface QuillBridgeInstance {
  root: HTMLElement;
  getText(): string;
  on(event: string, handler: (...args: unknown[]) => void): void;
  getLength(): number;
  formatText(index: number, len: number, format: string, value: unknown): void;
  setText(text: string): void;
  deleteText(index: number, len: number): void;
  insertText(index: number, text: string): void;
  focus(): void;
  findBlot?(node: Node): unknown;
  getIndex?(blot: unknown): number;
}

const maybeBridge = (
  globalThis as unknown as {
    QuillBridge?: {
      create: (
        container: string | HTMLElement,
        options?: unknown
      ) => QuillBridgeInstance;
    };
  }
).QuillBridge;
if (!maybeBridge) {
  throw new Error(
    "QuillBridge is not available. Ensure src/quill-bridge.js is loaded."
  );
}
const QuillBridge = maybeBridge;

export class GrammarChecker {
  private api: DivvunAPI;
  private config: GrammarCheckerConfig;
  private state: EditorState;
  private checkTimeout: ReturnType<typeof setTimeout> | null = null;

  // DOM elements
  private editor: QuillBridgeInstance; // Quill instance
  private languageSelect: HTMLSelectElement;
  private checkButton: HTMLButtonElement;
  private clearButton: HTMLButtonElement;
  private statusText: HTMLElement;
  private statusDisplay: HTMLElement;
  private errorCount: HTMLElement;
  private testButtons: { [key: string]: HTMLButtonElement };

  constructor() {
    this.config = {
      language: "se",
      apiUrl: "https://api-giellalt.uit.no/grammar",
      autoCheckDelay: 2000,
      maxRetries: 3,
    };

    this.state = {
      lastCheckedContent: "",
      errors: [],
      isChecking: false,
      errorSpans: [],
    };

    this.api = new DivvunAPI();

    // Initialize Quill editor via the bridge
    const editorContainer = document.getElementById("editor") as HTMLElement;
    this.editor = QuillBridge.create(editorContainer, {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, false] }],
          ["bold", "italic", "underline"],
          ["link", "clean"],
        ],
      },
    });

    // Ensure editor root is focusable
    this.editor.root.setAttribute("aria-label", "Grammar editor");
    // Disable native browser spellcheck inside Quill editor
    try {
      this.editor.root.setAttribute("spellcheck", "false");
    } catch (_err) {
      // ignore
    }

    // Get other DOM elements
    this.languageSelect = document.getElementById(
      "language-select"
    ) as HTMLSelectElement;
    this.clearButton = document.getElementById(
      "clear-btn"
    ) as HTMLButtonElement;
    this.statusText = document.getElementById("status-text") as HTMLElement;
    this.statusDisplay = document.getElementById(
      "status-display"
    ) as HTMLElement;
    this.errorCount = document.getElementById("error-count") as HTMLElement;

    this.testButtons = {
      user: document.getElementById("test-user") as HTMLButtonElement,
      grammar: document.getElementById("test-grammar") as HTMLButtonElement,
      mixed: document.getElementById("test-mixed") as HTMLButtonElement,
    };

    // Populate language options from API and then wire up events
    this.populateLanguageOptions();
    this.setupEventListeners();
    console.log("Grammar checker initialized successfully");
  }

  private populateLanguageOptions(): void {
    try {
      const languages = this.api.getSupportedLanguages();
      // Clear existing options
      this.languageSelect.innerHTML = "";
      languages.forEach((lang) => {
        const opt = document.createElement("option");
        opt.value = lang.code;
        opt.textContent = lang.name;
        this.languageSelect.appendChild(opt);
      });

      // Set the select to the configured language if available
      let found = false;
      for (let i = 0; i < this.languageSelect.options.length; i++) {
        if (this.languageSelect.options[i].value === this.config.language) {
          found = true;
          break;
        }
      }

      if (found) {
        this.languageSelect.value = this.config.language;
      } else if (this.languageSelect.options.length > 0) {
        this.config.language = this.languageSelect.options[0]
          .value as SupportedLanguage;
        this.languageSelect.value = this.config.language;
      }
    } catch (_err) {
      // If populating languages fails, leave existing static options as fallback
    }
  }

  private setupEventListeners(): void {
    // Auto-check on text change with debouncing (Quill emits 'text-change')
    this.editor.on("text-change", () => {
      if (this.checkTimeout) {
        clearTimeout(this.checkTimeout);
      }

      this.checkTimeout = setTimeout(() => {
        this.checkGrammar();
      }, this.config.autoCheckDelay);
    });

    // Language selection
    this.languageSelect.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      this.setLanguage(target.value as SupportedLanguage);
    });

    // Manual check button
    this.checkButton.addEventListener("click", () => {
      this.checkGrammar();
    });

    // Clear button
    this.clearButton.addEventListener("click", () => {
      this.clearEditor();
    });

    // Test buttons
    this.testButtons.user.addEventListener("click", () => {
      this.testUserExample();
    });

    this.testButtons.grammar.addEventListener("click", () => {
      this.testGrammarErrors();
    });

    this.testButtons.mixed.addEventListener("click", () => {
      this.testMixedErrors();
    });

    // Click outside to close tooltips
    document.addEventListener("click", (e) => {
      const existingTooltip = document.querySelector(".error-tooltip");
      if (existingTooltip && !existingTooltip.contains(e.target as Node)) {
        existingTooltip.remove();
      }
    });

    // Click on an error span to show suggestions
    this.editor.root.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const errorNode = target.closest(
        ".grammar-typo, .grammar-other"
      ) as HTMLElement;
      if (!errorNode) return;

      // Use Quill's blot find to determine index and length
      try {
        const blot = this.editor.findBlot
          ? this.editor.findBlot(errorNode)
          : undefined;
        const index =
          this.editor.getIndex && blot !== undefined
            ? this.editor.getIndex(blot)
            : 0;
        const maybeLength =
          blot && typeof (blot as { length?: unknown }).length === "function"
            ? (blot as { length: () => number }).length()
            : 0;
        const length = maybeLength ?? 0;

        // Find matching error by index
        const matching = this.state.errors.find(
          (err) =>
            err.start_index === index &&
            err.end_index - err.start_index === length
        );
        if (matching) {
          this.showSuggestionTooltip(
            errorNode,
            matching,
            index,
            length,
            e as MouseEvent
          );
        }
      } catch (_err) {
        // ignore
      }
    });
  }

  async checkGrammar(): Promise<void> {
    const currentText = this.editor.getText();

    // Don't check if content hasn't changed or is empty
    if (this.state.isChecking) return;
    if (!currentText || currentText.trim() === "") return;
    if (currentText === this.state.lastCheckedContent) return;

    this.state.isChecking = true;
    this.updateStatus("Checking...", true);
    this.checkButton.disabled = true;

    try {
      const response = await this.api.checkText(
        currentText,
        this.config.language
      );

      this.state.lastCheckedContent = currentText;
      this.state.errors = response.errs;
      this.highlightErrors(response.errs);

      const errorCount = response.errs.length;
      this.updateStatus("Ready", false);
      this.updateErrorCount(errorCount);
    } catch (error) {
      console.error("Grammar check failed:", error);
      this.updateStatus("Error checking grammar", false);
      this.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.state.isChecking = false;
      this.checkButton.disabled = false;
    }
  }

  private highlightErrors(errors: DivvunError[]): void {
    // Clear existing error formatting across the document
    try {
      const docLength = this.editor.getLength();
      this.editor.formatText(0, docLength, "grammar-typo", false);
      this.editor.formatText(0, docLength, "grammar-other", false);
    } catch (_err) {
      // ignore
    }

    if (!errors || errors.length === 0) return;

    // Robust formatting: try index-based formatting first; if that fails, fallback to text search
    const docText = this.editor.getText();
    const docLen = docText.length;

    errors.forEach((error, idx) => {
      const start =
        typeof error.start_index === "number" ? error.start_index : null;
      const end = typeof error.end_index === "number" ? error.end_index : null;
      const len = start !== null && end !== null ? Math.max(0, end - start) : 0;
      const isTypo =
        error.error_code === "typo" ||
        (error.title && String(error.title).toLowerCase().includes("typo"));
      const formatName = isTypo ? "grammar-typo" : "grammar-other";

      let applied = false;
      if (start !== null && len > 0 && start < docLen) {
        try {
          this.editor.formatText(start, len, formatName, true);
          applied = true;
        } catch (_err) {
          applied = false;
        }
      }

      if (!applied && error.error_text) {
        try {
          const needle = String(error.error_text).trim();
          if (needle.length > 0) {
            const foundIndex = docText.indexOf(needle);
            if (foundIndex !== -1) {
              this.editor.formatText(
                foundIndex,
                needle.length,
                formatName,
                true
              );
              applied = true;
            }
          }
        } catch (_err) {
          // ignore
        }
      }
    });
  }

  private showSuggestionTooltip(
    _anchor: HTMLElement,
    error: DivvunError,
    index: number,
    length: number,
    ev: MouseEvent
  ) {
    // Remove existing tooltip
    const existing = document.querySelector(".error-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "error-tooltip";

    const title = document.createElement("div");
    title.className = "error-title";
    title.textContent = error.title || "Suggestion";
    tooltip.appendChild(title);

    if (error.description) {
      const desc = document.createElement("div");
      desc.className = "error-description";
      desc.textContent = error.description;
      tooltip.appendChild(desc);
    }

    const ul = document.createElement("ul");
    ul.className = "suggestions";
    const suggestions =
      error.suggestions && error.suggestions.length > 0
        ? error.suggestions
        : [error.error_text];
    suggestions.forEach((sugg) => {
      const li = document.createElement("li");
      li.textContent = sugg;
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        // Replace text in editor
        try {
          this.editor.deleteText(index, length);
          this.editor.insertText(index, sugg);
          // After replacement, clear formatting for that range
          this.editor.formatText(index, sugg.length, "grammar-typo", false);
          this.editor.formatText(index, sugg.length, "grammar-other", false);
          // Clear state errors and re-run check
          this.state.lastCheckedContent = "";
          this.clearErrors();
          this.checkGrammar();
        } catch (_err) {
          // ignore
        }
        tooltip.remove();
      });
      ul.appendChild(li);
    });
    tooltip.appendChild(ul);

    document.body.appendChild(tooltip);

    // Position near mouse but ensure within viewport
    const x = ev.clientX + 8;
    const y = ev.clientY + 8;
    const win = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
    };
    tooltip.style.left = `${Math.min(win.innerWidth - 320, x)}px`;
    tooltip.style.top = `${Math.min(win.innerHeight - 200, y)}px`;
  }

  private updateStatus(status: string, isChecking: boolean): void {
    this.statusText.textContent = status;
    this.statusDisplay.className = isChecking
      ? "status checking"
      : "status complete";

    // Add/remove spinner
    const existingSpinner = this.statusDisplay.querySelector(".spinner");
    if (isChecking && !existingSpinner) {
      const spinner = document.createElement("div");
      spinner.className = "spinner";
      this.statusDisplay.appendChild(spinner);
    } else if (!isChecking && existingSpinner) {
      existingSpinner.remove();
    }
  }

  private updateErrorCount(count: number): void {
    this.errorCount.textContent = `${count} ${
      count === 1 ? "error" : "errors"
    }`;
    this.errorCount.className =
      count > 0 ? "error-count has-errors" : "error-count";
  }

  private showErrorMessage(message: string): void {
    // Simple alert for now - in a full implementation, you'd want a nicer notification system
    alert(`Error: ${message}`);
  }

  setLanguage(language: SupportedLanguage): void {
    this.config.language = language;
    this.clearErrors();
    // Re-check with new language if there's content
    const text = this.getText();
    if (text && text.trim()) {
      this.state.lastCheckedContent = ""; // Force re-check
      this.checkGrammar();
    }
  }

  setText(text: string): void {
    this.editor.setText(text);
    this.state.lastCheckedContent = ""; // Force re-check
    this.checkGrammar();
  }

  getText(): string {
    return this.editor.getText();
  }

  clearEditor(): void {
    this.editor.setText("");
    this.clearErrors();
    this.editor.focus();
  }

  clearErrors(): void {
    this.state.errors = [];
    this.state.errorSpans = [];
    this.updateErrorCount(0);
    // Remove any grammar-error formatting
    try {
      const docLength = this.editor.getLength();
      this.editor.formatText(0, docLength, "grammar-error", false);
    } catch (_err) {
      // ignore
    }

    // Remove any tooltips
    const tooltips = document.querySelectorAll(".error-tooltip");
    tooltips.forEach((tooltip) => tooltip.remove());
  }

  // Test methods
  testUserExample(): void {
    this.setText("Dáll čálán davvsámgiela");
  }

  testGrammarErrors(): void {
    this.setText("Mun leat studeanta ja mun háliidan oahpahit sámegiella.");
  }

  testMixedErrors(): void {
    this.setText(
      "This textt has speling errors. Mun leat studeanta ja háliidan oahpahit sámegiella."
    );
  }

  // Public API for debugging
  getState(): EditorState {
    return { ...this.state };
  }

  getConfig(): GrammarCheckerConfig {
    return { ...this.config };
  }
}

// Initialize the grammar checker when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const grammarChecker = new GrammarChecker();

  // Make it available globally for debugging
  (
    globalThis as unknown as { grammarChecker?: GrammarChecker }
  ).grammarChecker = grammarChecker;
});
