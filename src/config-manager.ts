import {
  getAvailableLanguages,
  GrammarCheckerAPI,
  SpellCheckerAPI,
} from "./api.ts";
import {
  AvailableLanguage,
  CheckerApi,
  GrammarCheckerConfig,
  SupportedLanguage,
} from "./types.ts";

/**
 * Callbacks for configuration changes and initialization events
 */
export interface ConfigurationCallbacks {
  onLanguageChanged: (language: SupportedLanguage, api: CheckerApi) => void;
  onConfigurationInitialized: () => void;
  onLanguageInitializationError: (error: unknown) => void;
}

/**
 * ConfigManager handles all configuration management, language settings, API setup,
 * and initialization coordination for the grammar checker application.
 *
 * Responsibilities:
 * - Configuration management and validation
 * - Language switching and API creation
 * - Available languages loading and caching
 * - DOM element initialization and setup
 * - Application initialization coordination
 */
export class ConfigManager {
  private config: GrammarCheckerConfig;
  private api: CheckerApi;
  private availableLanguages: AvailableLanguage[] = [];
  private callbacks: ConfigurationCallbacks;

  // DOM Elements managed by ConfigManager
  private languageSelect!: HTMLSelectElement;
  private clearButton!: HTMLButtonElement;
  private statusText!: HTMLElement;
  private statusDisplay!: HTMLElement;
  private errorCount!: HTMLElement;

  constructor(callbacks: ConfigurationCallbacks) {
    this.callbacks = callbacks;

    // Initialize default configuration
    this.config = {
      language: "se",
      apiUrl: "https://api-giellalt.uit.no/grammar",
      autoCheckDelay: 600,
      maxRetries: 3,
    };

    // Create initial API for default language
    this.api = this.createApiForLanguage(this.config.language);

    // Initialize DOM elements
    this.initializeDOMElements();
  }

  /**
   * Initialize all DOM elements that ConfigManager needs to manage
   */
  private initializeDOMElements(): void {
    this.languageSelect = document.getElementById(
      "language-select",
    ) as HTMLSelectElement;
    this.clearButton = document.getElementById(
      "clear-btn",
    ) as HTMLButtonElement;
    this.statusText = document.getElementById("status-text") as HTMLElement;
    this.statusDisplay = document.getElementById(
      "status-display",
    ) as HTMLElement;
    this.errorCount = document.getElementById("error-count") as HTMLElement;
  }

  /**
   * Get the current configuration
   */
  getConfig(): GrammarCheckerConfig {
    return { ...this.config };
  }

  /**
   * Get the current API instance
   */
  getCurrentApi(): CheckerApi {
    return this.api;
  }

  /**
   * Get the current language
   */
  getCurrentLanguage(): SupportedLanguage {
    return this.config.language;
  }

  /**
   * Get available languages list
   */
  getAvailableLanguages(): AvailableLanguage[] {
    return [...this.availableLanguages];
  }

  /**
   * Get DOM elements managed by ConfigManager
   */
  getDOMElements() {
    return {
      languageSelect: this.languageSelect,
      clearButton: this.clearButton,
      statusText: this.statusText,
      statusDisplay: this.statusDisplay,
      errorCount: this.errorCount,
    };
  }

  /**
   * Create appropriate API instance for the given language
   */
  private createApiForLanguage(language: SupportedLanguage): CheckerApi {
    // Find the language in our available languages list
    const languageInfo = this.availableLanguages.find(
      (lang) => lang.code === language,
    );

    if (languageInfo) {
      // Use the API type specified by the server
      if (languageInfo.type === "speller") {
        return new SpellCheckerAPI();
      } else {
        return new GrammarCheckerAPI();
      }
    }

    // Fallback logic if language not found in API data
    // SMS uses spell checker, all others use grammar checker
    if (language === "sms") {
      return new SpellCheckerAPI();
    } else {
      return new GrammarCheckerAPI();
    }
  }

  /**
   * Set the current language and update API accordingly
   */
  setLanguage(language: SupportedLanguage): void {
    console.debug("🔧 ConfigManager: Setting language to", language);

    const previousLanguage = this.config.language;
    this.config.language = language;

    // Create appropriate API for the new language
    this.api = this.createApiForLanguage(language);

    console.debug(
      "🔧 ConfigManager: Language changed from",
      previousLanguage,
      "to",
      language,
    );

    // Notify callback about language change
    this.callbacks.onLanguageChanged(language, this.api);
  }

  /**
   * Update configuration settings
   */
  updateConfig(newConfig: Partial<GrammarCheckerConfig>): void {
    console.debug("🔧 ConfigManager: Updating configuration", newConfig);

    this.config = { ...this.config, ...newConfig };

    // If language changed, update API
    if (newConfig.language && newConfig.language !== this.config.language) {
      this.setLanguage(newConfig.language);
    }
  }

  /**
   * Initialize available languages by fetching from API
   */
  async initializeLanguages(): Promise<void> {
    console.debug("🔧 ConfigManager: Initializing available languages");

    try {
      // Fetch available languages from API
      this.availableLanguages = await getAvailableLanguages();

      console.debug(
        "🔧 ConfigManager: Loaded",
        this.availableLanguages.length,
        "languages",
      );

      // Re-initialize the API with the current language using the new data
      this.api = this.createApiForLanguage(this.config.language);

      // Notify that configuration is initialized
      this.callbacks.onConfigurationInitialized();

      console.debug(
        "🔧 ConfigManager: Language initialization completed successfully",
      );
    } catch (error) {
      console.warn("⚠️ ConfigManager: Failed to initialize languages:", error);

      // Notify about the error
      this.callbacks.onLanguageInitializationError(error);

      // Continue with current API setup as fallback
      console.debug("🔧 ConfigManager: Continuing with fallback API setup");
    }
  }

  /**
   * Validate that all required DOM elements are available
   */
  validateDOMElements(): { isValid: boolean; missingElements: string[] } {
    const missingElements: string[] = [];

    if (!this.languageSelect) {
      missingElements.push("language-select");
    }
    if (!this.clearButton) {
      missingElements.push("clear-btn");
    }
    if (!this.statusText) {
      missingElements.push("status-text");
    }
    if (!this.statusDisplay) {
      missingElements.push("status-display");
    }
    if (!this.errorCount) {
      missingElements.push("error-count");
    }

    return {
      isValid: missingElements.length === 0,
      missingElements,
    };
  }

  /**
   * Check if required global dependencies are available
   */
  static validateGlobalDependencies(): {
    isValid: boolean;
    missingDependencies: string[];
  } {
    const missingDependencies: string[] = [];

    // Check if Quill is available
    const quill = (globalThis as unknown as { Quill?: unknown })?.Quill;
    if (!quill) {
      missingDependencies.push("Quill");
    }

    // Check if QuillBridge is available
    const bridge = (globalThis as unknown as { QuillBridge?: unknown })
      ?.QuillBridge;
    if (!bridge) {
      missingDependencies.push("QuillBridge");
    }

    // Check if editor element exists
    const editorElement = document.getElementById("editor");
    if (!editorElement) {
      missingDependencies.push("editor element");
    }

    return {
      isValid: missingDependencies.length === 0,
      missingDependencies,
    };
  }

  /**
   * Get configuration for auto-check delay
   */
  getAutoCheckDelay(): number {
    return this.config.autoCheckDelay;
  }

  /**
   * Get configuration for API URL
   */
  getApiUrl(): string {
    return this.config.apiUrl;
  }

  /**
   * Get configuration for max retries
   */
  getMaxRetries(): number {
    return this.config.maxRetries;
  }
}
