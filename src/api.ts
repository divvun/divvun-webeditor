import type {
  ApiLanguageResponse,
  AvailableLanguage,
  CheckerApi,
  CheckerError,
  CheckerResponse,
  SpellCheckerResponse,
  SupportedLanguage,
} from "./types.ts";

/**
 * Simple LRU (Least Recently Used) cache implementation
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Delete if exists (to re-insert at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add to end
    this.cache.set(key, value);

    // Remove oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export class GrammarCheckerAPI implements CheckerApi {
  private cache: LRUCache<string, CheckerResponse>;
  private readonly baseUrl = "https://api-giellalt.uit.no/grammar";
  private readonly timeout = 10000; // 10 seconds

  constructor(cache: LRUCache<string, CheckerResponse>) {
    this.cache = cache;
  }

  async checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    if (!text.trim()) {
      return { text, errs: [] };
    }

    // Create cache key from text and language
    const cacheKey = `${language}:${text}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.debug(`📦 Cache hit for ${language} (${text.length} chars)`);
      return cached;
    }

    console.debug(
      `🌐 Cache miss, fetching from API for ${language} (${text.length} chars)`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/${language}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Language "${language}" is not supported by the Divvun API`,
          );
        } else if (response.status >= 500) {
          throw new Error("Divvun API server error. Please try again later.");
        } else {
          throw new Error(`API request failed with status ${response.status}`);
        }
      }

      const data: CheckerResponse = await response.json();

      // Store in cache
      this.cache.set(cacheKey, data);

      return data;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout: The grammar check took longer than ${this.timeout}ms`,
          );
        }
        throw error;
      }

      throw new Error(`Grammar check failed: ${String(error)}`);
    }
  }

  getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
    return [
      { code: "se", name: "Davvisámegiella (Northern sami)" },
      { code: "sma", name: "Åarjelsaemien (Southern sami)" },
      { code: "smj", name: "Julevsámegiella (Lule sami)" },
      { code: "smn", name: "Anarâškielâ (Inari sami)" },
      { code: "fo", name: "Føroyskt (Faroese)" },
      { code: "ga", name: "Gaeilge (Irish)" },
      { code: "kl", name: "Kalaallisut (Greenlandic)" },
      { code: "nb", name: "Norsk bokmål (Norwegian bokmål)" },
    ];
  }
}

export class SpellCheckerAPI implements CheckerApi {
  private cache: LRUCache<string, CheckerResponse>;
  private readonly baseUrl = "https://api-giellalt.uit.no/speller";
  private readonly timeout = 10000; // 10 seconds

  constructor(cache: LRUCache<string, CheckerResponse>) {
    this.cache = cache;
  }

  async checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    if (!text.trim()) {
      return { text, errs: [] };
    }

    // Create cache key from text and language
    const cacheKey = `${language}:${text}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.debug(
        `📦 Cache hit for ${language} speller (${text.length} chars)`,
      );
      return cached;
    }

    console.debug(
      `🌐 Cache miss, fetching from speller API for ${language} (${text.length} chars)`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/${language}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Language "${language}" is not supported by the Spell Checker API`,
          );
        } else if (response.status >= 500) {
          throw new Error(
            "Spell Checker API server error. Please try again later.",
          );
        } else {
          throw new Error(`API request failed with status ${response.status}`);
        }
      }

      const data: SpellCheckerResponse = await response.json();

      // Convert SpellResult[] to CheckerError[]
      const errors: CheckerError[] = [];

      // Process each result from the spell checker
      data.results.forEach((result) => {
        // Only process words that are marked as incorrect
        if (!result.is_correct) {
          // Find the position of this word in the original text
          const wordIndex = text.indexOf(result.word);

          if (wordIndex !== -1) {
            errors.push({
              error_text: result.word,
              start_index: wordIndex,
              end_index: wordIndex + result.word.length,
              error_code: "typo",
              description: "Possible spelling error",
              suggestions: result.suggestions.map((s) => s.value),
              title: "Suggestion",
            });
          }
        } else {
          // Optionally log skipped words for debugging if needed
        }
      });

      const result = { text, errs: errors };

      // Store in cache
      this.cache.set(cacheKey, result);

      return result;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout: The spell check took longer than ${this.timeout}ms`,
          );
        }
        throw error;
      }

      throw new Error(`Spell check failed: ${String(error)}`);
    }
  }

  getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
    // Return only SMS for spell checker
    return [{ code: "sms", name: "Nuõrttsääʹmǩiõll (Skolt sami)" }];
  }
}

/**
 * Fetch available languages from the API server and process them according to business rules:
 * 1. Exclude SMS from grammar checking (SMS grammar doesn't work right now)
 * 2. If a language has both grammar and speller, prefer grammar
 * 3. Return the filtered and processed language list
 */
export async function getAvailableLanguages(): Promise<AvailableLanguage[]> {
  try {
    const response = await fetch("https://api-giellalt.uit.no/languages");
    if (!response.ok) {
      throw new Error(`Failed to fetch languages: ${response.status}`);
    }

    const data: ApiLanguageResponse = await response.json();
    const languages: AvailableLanguage[] = [];

    // Process grammar languages (exclude SMS as per requirements)
    Object.entries(data.available.grammar).forEach(([code, name]) => {
      if (code !== "sms") {
        // Exclude SMS from grammar as it doesn't work
        languages.push({
          code: code as SupportedLanguage,
          name: name,
          type: "grammar",
        });
      }
    });

    // Process speller languages
    Object.entries(data.available.speller).forEach(([code, name]) => {
      // Only add speller languages that don't already have grammar support
      const hasGrammar = languages.some((lang) => lang.code === code);
      if (!hasGrammar) {
        languages.push({
          code: code as SupportedLanguage,
          name: name,
          type: "speller",
        });
      }
      // If a language has both grammar and speller, grammar takes precedence (already added above)
    });

    // Sort by language code for consistent ordering
    languages.sort((a, b) => a.code.localeCompare(b.code));

    return languages;
  } catch (error) {
    console.warn(
      "Failed to fetch languages from API, falling back to defaults:",
      error,
    );
    // Fallback to some default languages if API fails
    return [
      { code: "se", name: "Davvisámegiella (Northern sami)", type: "grammar" },
      { code: "sms", name: "Nuõrttsääʹmǩiõll (Skolt sami)", type: "speller" },
    ];
  }
}
