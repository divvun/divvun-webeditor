import type { GrammarCheckerResponse, SupportedLanguage } from "./types.ts";

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
