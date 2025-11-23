import {
  getAvailableCheckerCombinations,
  GrammarCheckerAPI,
  SpellCheckerAPI,
} from "./api.ts";
import {
  CheckerApi,
  CheckerCombination,
  SupportedLanguage,
  TextCheckerConfig,
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
  private config: TextCheckerConfig;
  private api: CheckerApi;
  private availableLanguages: CheckerCombination[] = [];
  private callbacks: ConfigurationCallbacks;
  private currentEnvironment: import("./types.ts").ApiEnvironment = "stable";
  private currentCheckerType: import("./types.ts").CheckerType = "grammar";

  // DOM Elements managed by ConfigManager
  private languageSelect!: HTMLSelectElement;
  private clearButton!: HTMLButtonElement;
  private statusText!: HTMLElement;
  private statusDisplay!: HTMLElement;
  private errorCount!: HTMLElement;
  private retryButton!: HTMLButtonElement;

  constructor(callbacks: ConfigurationCallbacks) {
    this.callbacks = callbacks;

    // Get language from URL or use default
    const urlLanguage = this.getLanguageFromURL();

    // Initialize default configuration
    this.config = {
      language: urlLanguage,
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
   * Extract language code from URL parameter
   * Supports formats: ?lang=se or ?language=se
   *
   * Note: This does basic validation at construction time. Full validation
   * against available languages from the API happens during initializeLanguages().
   */
  private getLanguageFromURL(): SupportedLanguage {
    const urlParams = new URLSearchParams(globalThis.location.search);
    const langParam = urlParams.get("lang") || urlParams.get("language");

    if (langParam) {
      // Basic type validation - check if it matches the SupportedLanguage type pattern
      // More detailed validation will happen when available languages are loaded
      const langCode = langParam as SupportedLanguage;

      console.log(`🌐 Language from URL: ${langCode}`);
      return langCode;
    }

    return "se"; // Default language
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
    this.retryButton = document.getElementById(
      "retry-button",
    ) as HTMLButtonElement;
  }

  /**
   * Get the current configuration
   */
  getConfig(): TextCheckerConfig {
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
  getAvailableLanguages(): CheckerCombination[] {
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
      retryButton: this.retryButton,
    };
  }

  /**
   * Create appropriate API instance for the given language, environment, and checker type
   */
  private createApiForLanguage(
    _language: SupportedLanguage,
    environment?: import("./types.ts").ApiEnvironment,
    checkerType?: import("./types.ts").CheckerType,
  ): CheckerApi {
    // Use provided parameters or fall back to current values
    const env = environment || this.currentEnvironment;
    const type = checkerType || this.currentCheckerType;

    // Update current values
    this.currentEnvironment = env;
    this.currentCheckerType = type;

    // Create API based on type and environment
    if (type === "speller") {
      return new SpellCheckerAPI(env);
    } else {
      return new GrammarCheckerAPI(env);
    }
  }

  /**
   * Set the current language and update API accordingly
   * Optionally specify environment and checker type
   */
  setLanguage(
    language: SupportedLanguage,
    environment?: import("./types.ts").ApiEnvironment,
    checkerType?: import("./types.ts").CheckerType,
  ): void {
    console.debug(
      "🔧 ConfigManager: Setting language to",
      language,
      environment || this.currentEnvironment,
      checkerType || this.currentCheckerType,
    );

    const previousLanguage = this.config.language;
    this.config.language = language;

    // Create appropriate API for the new language, environment, and type
    this.api = this.createApiForLanguage(language, environment, checkerType);

    console.debug(
      "🔧 ConfigManager: Language changed from",
      previousLanguage,
      "to",
      language,
      `(${this.currentEnvironment} ${this.currentCheckerType})`,
    );

    // Notify callback about language change
    this.callbacks.onLanguageChanged(language, this.api);
  }

  /**
   * Update configuration settings
   */
  updateConfig(newConfig: Partial<TextCheckerConfig>): void {
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
      // Fetch available languages from API (already validated and filtered)
      this.availableLanguages = await getAvailableCheckerCombinations();

      console.log(
        `🔧 ConfigManager: ${this.availableLanguages.length} working checker combinations loaded`,
      );

      // Validate that the current language (possibly from URL) is actually available
      const isLanguageAvailable = this.availableLanguages.some(
        (lang) => lang.code === this.config.language,
      );

      if (!isLanguageAvailable) {
        console.warn(
          `⚠️ Language '${this.config.language}' from URL is not available. Falling back to 'se'`,
        );
        this.config.language = "se";
      }

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
