import type {
  GrammarCheckerResponse,
  SupportedLanguage,
  SpellCheckerResponse,
  CheckerError,
} from "./types.ts";

export class GrammarCheckerAPI {
  private readonly baseUrl = "https://api-giellalt.uit.no/grammar";
  private readonly timeout = 10000; // 10 seconds

  async checkText(
    text: string,
    language: SupportedLanguage
  ): Promise<GrammarCheckerResponse> {
    if (!text.trim()) {
      return { text, errs: [] };
    }

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
            `Language "${language}" is not supported by the Divvun API`
          );
        } else if (response.status >= 500) {
          throw new Error("Divvun API server error. Please try again later.");
        } else {
          throw new Error(`API request failed with status ${response.status}`);
        }
      }

      const data: GrammarCheckerResponse = await response.json();
      return data;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout: The grammar check took longer than ${this.timeout}ms`
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

export async function checkGrammar(
  text: string,
  language: SupportedLanguage
): Promise<GrammarCheckerResponse> {
  const api = new GrammarCheckerAPI();
  return await api.checkText(text, language);
}

export class SpellCheckerAPI {
  private readonly baseUrl = "https://api-giellalt.uit.no/speller";
  private readonly timeout = 10000; // 10 seconds

  async checkText(
    text: string,
    language: SupportedLanguage
  ): Promise<CheckerError[]> {
    if (!text.trim()) {
      return [];
    }

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
            `Language "${language}" is not supported by the Spell Checker API`
          );
        } else if (response.status >= 500) {
          throw new Error(
            "Spell Checker API server error. Please try again later."
          );
        } else {
          throw new Error(`API request failed with status ${response.status}`);
        }
      }

      const data: SpellCheckerResponse = await response.json();
      console.log("Spell checker response:", data);

      // Convert SpellResult[] to GrammarCheckerError[]
      const errors: CheckerError[] = [];
      let wordStartIndex = 0;

      // Split text into words and process results
      const words = text.split(/\s+/);

      data.results.forEach((result, index) => {
        if (index < words.length && !result.is_correct) {
          const word = words[index];
          const wordIndex = text.indexOf(word, wordStartIndex);

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
        }

        // Update word start index for next iteration
        if (index < words.length) {
          const word = words[index];
          const wordIndex = text.indexOf(word, wordStartIndex);
          wordStartIndex = wordIndex + word.length;
        }
      });

      return errors;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout: The spell check took longer than ${this.timeout}ms`
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

export async function checkSpelling(
  text: string,
  language: SupportedLanguage
): Promise<CheckerError[]> {
  const api = new SpellCheckerAPI();
  return await api.checkText(text, language);
}
