// ConfigManager now handles API imports
import type {
  CheckerApi,
  CheckerError,
  CheckerState,
  SupportedLanguage,
} from "./types.ts";
import { CursorManager } from "./cursor-manager.ts";
import {
  type SuggestionCallbacks,
  SuggestionManager,
} from "./suggestion-manager.ts";
import { type TextAnalysisCallbacks, TextAnalyzer } from "./text-analyzer.ts";
import {
  CheckerStateMachine,
  type EditInfo,
  type EditType,
  type StateTransitionCallbacks,
} from "./checker-state-machine.ts";
import { type EventCallbacks, EventManager } from "./event-manager.ts";
import {
  ErrorHighlighter,
  type HighlightingCallbacks,
} from "./error-highlighter.ts";
import {
  ConfigManager,
  type ConfigurationCallbacks,
} from "./config-manager.ts";
import { QuillBridge, registerQuillBlots } from "./quill-bridge-instance.ts";
import { TextChecker } from "./text-checker.ts";
import { LRUCache } from "./lru-cache.ts";
import { showUpdateNotification, VersionChecker } from "./version-checker.ts";

/**
 * Maximum number of items to store in the text analysis cache
 */
const TEXT_ANALYZER_CACHE_SIZE = 1000;

// Initialize the text checker when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Check if required elements exist
  const editorElement = document.getElementById("editor");

  if (!editorElement) {
    console.error("Editor element not found!");
    return;
  }

  // Check if Quill is available
  const quill = (globalThis as unknown as { Quill?: unknown })?.Quill;

  // Check if QuillBridge is available
  const bridge = (globalThis as unknown as { QuillBridge?: unknown })
    ?.QuillBridge;

  if (!quill) {
    console.error("Quill.js not loaded!");
    return;
  }

  if (!bridge) {
    console.error("QuillBridge not loaded!");
    return;
  }

  try {
    // Register custom Quill blots for error highlighting
    registerQuillBlots();

    // Create the Quill editor
    const editorContainer = document.getElementById("editor") as HTMLElement;
    const editor = QuillBridge.create(editorContainer, {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, false] }],
          ["bold", "italic", "underline"],
          ["link", "clean"],
        ],
      },
    });

    // Focus the editor when app starts
    editor.focus();

    // Create the configuration manager with callbacks
    // Note: Callbacks reference textChecker methods, which we'll set up after instantiation
    let textCheckerInstance: TextChecker | null = null;

    const configCallbacks: ConfigurationCallbacks = {
      onLanguageChanged: (language: SupportedLanguage, api: CheckerApi) => {
        textCheckerInstance?.handleLanguageChange(language, api);
      },
      onConfigurationInitialized: () => {
        console.log("🔧 Configuration initialized successfully");
      },
      onLanguageInitializationError: (error: unknown) => {
        console.warn("⚠️ Language initialization failed:", error);
      },
    };

    const configManager = new ConfigManager(configCallbacks);

    // Create the cursor manager
    const cursorManager = new CursorManager(editor);

    // Create the suggestion manager with callbacks
    // Note: These callbacks will be bound to textChecker methods after it's created
    let textCheckerRef: TextChecker | null = null;
    const suggestionCallbacks: SuggestionCallbacks = {
      onSuggestionApplied: (error: CheckerError, suggestion: string) => {
        textCheckerRef?.applySuggestion(error, suggestion);
      },
      onClearErrors: () => {
        if (textCheckerRef) {
          textCheckerRef.state.lastCheckedContent = "";
          textCheckerRef.errorHighlighter.clearErrors();
        }
      },
      onCheckText: () => {
        textCheckerRef?.textAnalyzer.checkText();
      },
      onRecheckLine: (lineNumber: number) => {
        textCheckerRef?.recheckModifiedLine(lineNumber);
      },
    };
    const suggestionManager = new SuggestionManager(
      editor,
      suggestionCallbacks,
    );

    // Create the text analyzer with callbacks
    const textAnalysisCallbacks: TextAnalysisCallbacks = {
      onErrorsFound: (errors: CheckerError[], lineNumber?: number) => {
        if (lineNumber !== undefined) {
          textCheckerRef?.errorHighlighter.highlightLineErrors(errors)
            .catch((error) => {
              console.error("Error during line highlighting:", error);
            });
        } else {
          if (textCheckerRef) {
            textCheckerRef.state.errors = errors;
            textCheckerRef.eventManager.updateErrors(errors);
          }
        }
      },
      onUpdateErrorCount: (count: number) => {
        textCheckerRef?.updateErrorCount(count);
      },
      onUpdateStatus: (status: string, isChecking: boolean) => {
        textCheckerRef?.updateStatus(status, isChecking);
      },
      onShowErrorMessage: (message: string) => {
        textCheckerRef?.showErrorMessage(message);
      },
    };
    const textAnalyzer = new TextAnalyzer(
      configManager.getCurrentApi(),
      editor,
      textAnalysisCallbacks,
      configManager.getCurrentLanguage(),
      new LRUCache(TEXT_ANALYZER_CACHE_SIZE),
    );

    // Create the state machine with callbacks
    const stateTransitionCallbacks: StateTransitionCallbacks = {
      onStateEntry: (state: CheckerState) => {
        textCheckerRef?.onStateEntry(state);
      },
      onStateExit: (state: CheckerState) => {
        textCheckerRef?.onStateExit(state);
      },
      onCheckRequested: () => {
        textCheckerRef?.performTextCheck();
      },
      onEditDetected: (editType: EditType, editInfo: EditInfo) => {
        console.log(
          `🚨 CALLBACK onEditDetected called with ${editType}`,
          editInfo,
        );
        textCheckerRef?.handleEditDetected(editType, editInfo);
      },
    };
    const stateMachine = new CheckerStateMachine(
      configManager.getAutoCheckDelay(),
      stateTransitionCallbacks,
    );

    // Create the event manager with callbacks
    const eventCallbacks: EventCallbacks = {
      onTextChange: (source: string, currentText: string) => {
        textCheckerRef?.handleTextChange(source, currentText);
      },
      onLanguageChange: (language: SupportedLanguage) => {
        textCheckerRef?.setLanguage(language);
      },
      onClearEditor: () => {
        textCheckerRef?.clearEditor();
      },
      onRetryCheck: () => {
        // Retry the last failed text check
        if (textCheckerRef) {
          textCheckerRef.stateMachine.retryCheck();
          textCheckerRef.performTextCheck();
        }
      },
      onErrorClick: (
        errorNode: HTMLElement,
        matching: CheckerError,
        index: number,
        length: number,
        event: MouseEvent,
      ) => {
        textCheckerRef?.suggestionManager.showSuggestionTooltip(
          errorNode,
          matching,
          index,
          length,
          event,
        );
      },
      onErrorRightClick: (
        x: number,
        y: number,
        matchingError: CheckerError,
      ) => {
        textCheckerRef?.suggestionManager.showContextMenu(
          x,
          y,
          matchingError,
        );
      },
      onIntelligentPasteCheck: (
        prePasteSelection: { index: number; length: number },
        prePasteText: string,
        pastedContent: string,
      ) => {
        textCheckerRef?.handleIntelligentPasteCheck(
          prePasteSelection,
          prePasteText,
          pastedContent,
        );
      },
    };
    const domElements = configManager.getDOMElements();
    const eventManager = new EventManager(
      editor,
      domElements.clearButton,
      domElements.retryButton,
      eventCallbacks,
    );

    // Create the error highlighter with callbacks
    const highlightingCallbacks: HighlightingCallbacks = {
      onHighlightingStart: () => {
        if (textCheckerRef) {
          textCheckerRef.isHighlighting = true;
          textCheckerRef.eventManager.setHighlightingState(true);
        }
      },
      onHighlightingComplete: () => {
        if (textCheckerRef) {
          textCheckerRef.isHighlighting = false;
          textCheckerRef.eventManager.setHighlightingState(false);
          textCheckerRef.stateMachine.onHighlightingComplete();
        }
      },
      onHighlightingAborted: () => {
        if (textCheckerRef) {
          // Highlighting was aborted due to document changes during async operation
          // We need to re-check with the current document state
          console.debug(
            "🔄 Highlighting aborted, triggering immediate re-check",
          );
          textCheckerRef.isHighlighting = false;
          textCheckerRef.eventManager.setHighlightingState(false);
          // Signal state machine that highlighting was aborted
          textCheckerRef.stateMachine.onHighlightingAborted();
        }
      },
      onErrorsCleared: () => {
        if (textCheckerRef) {
          textCheckerRef.state.errors = [];
          textCheckerRef.eventManager.updateErrors([]);
          textCheckerRef.state.errorSpans = [];
          textCheckerRef.updateErrorCount(0);
        }
      },
    };
    const errorHighlighter = new ErrorHighlighter(
      editor,
      cursorManager,
      highlightingCallbacks,
    );

    // Create the text checker with all dependencies
    const textChecker = new TextChecker(
      editor,
      configManager,
      cursorManager,
      suggestionManager,
      textAnalyzer,
      stateMachine,
      eventManager,
      errorHighlighter,
    );
    textCheckerInstance = textChecker;
    textCheckerRef = textChecker;

    // Initialize languages asynchronously
    textChecker
      .initializeLanguages()
      .then(() => {
        console.log("Languages initialized successfully");
      })
      .catch((error) => {
        console.warn("Language initialization failed:", error);
      });

    // Make it available globally for debugging
    (
      globalThis as unknown as { textChecker?: TextChecker }
    ).textChecker = textChecker;

    // Restore editor content if this is after a version upgrade
    if (VersionChecker.hasContentToRestore()) {
      const restoredContent = VersionChecker.restoreEditorContent();
      if (restoredContent) {
        editor.setText(restoredContent);
        console.log("✅ Editor content restored after version upgrade");
      }
    }

    // Initialize version checker
    const versionChecker = new VersionChecker();
    versionChecker.startChecking(() => {
      showUpdateNotification(
        () => {
          versionChecker.reloadPage();
        },
        () => editor.getText(), // Pass editor content getter
      );
    });

    // Register service worker for offline support and version management
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => {
          console.log("Service Worker registered:", registration);

          // Check for updates when a new service worker is waiting
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  // New service worker available, show update notification
                  showUpdateNotification(
                    () => {
                      // Save editor content before reloading
                      const content = editor.getText();
                      VersionChecker.saveEditorContent(content);
                      // Tell the new service worker to skip waiting
                      newWorker.postMessage({ type: "SKIP_WAITING" });
                      globalThis.location.reload();
                    },
                    () => editor.getText(), // Pass editor content getter
                  );
                }
              });
            }
          });
        })
        .catch((error) => {
          console.warn("Service Worker registration failed:", error);
        });
    }
  } catch (error) {
    console.error("Error initializing text checker:", error);
  }
});
