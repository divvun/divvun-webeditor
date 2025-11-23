import type {
  ApiLanguageResponse,
  CheckerApi,
  CheckerCombination,
  CheckerError,
  CheckerResponse,
  SpellCheckerResponse,
  SupportedLanguage,
  TTSRequest,
  TTSVoice,
} from "./types.ts";

/**
 * Base URLs for all API environments
 */
const API_BASE_URLS = {
  stable: "https://api.giellalt.org",
  beta: "https://beta.api.giellalt.org",
  dev: "https://dev.api.giellalt.org",
} as const;

export class GrammarCheckerAPI implements CheckerApi {
  private readonly baseUrl: string;
  private readonly timeout = 10000; // 10 seconds

  constructor(environment: import("./types.ts").ApiEnvironment = "stable") {
    this.baseUrl = `${API_BASE_URLS[environment]}/grammar`;
  }

  async checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    if (!text.trim()) {
      return { text, errs: [] };
    }

    console.debug(
      `🌐 Fetching from API for ${language} (${text.length} chars)`,
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

      // Return raw API response - text-analyzer will handle index adjustments
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
}

export class SpellCheckerAPI implements CheckerApi {
  private readonly baseUrl: string;
  private readonly timeout = 10000; // 10 seconds

  constructor(environment: import("./types.ts").ApiEnvironment = "stable") {
    this.baseUrl = `${API_BASE_URLS[environment]}/speller`;
  }

  async checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    if (!text.trim()) {
      return { text, errs: [] };
    }

    console.debug(
      `🌐 Fetching from speller API for ${language} (${text.length} chars)`,
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
}

/**
 * Fetch languages from a specific API environment
 */
async function fetchCheckerCombinationsFromEnvironment(
  environment: import("./types.ts").ApiEnvironment,
): Promise<CheckerCombination[]> {
  const baseUrl = API_BASE_URLS[environment];
  const response = await fetch(`${baseUrl}/languages`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch languages from ${environment}: ${response.status}`,
    );
  }

  const data: ApiLanguageResponse = await response.json();
  const checkerCombinations: CheckerCombination[] = [];

  // Process grammar languages
  Object.entries(data.available.grammar).forEach(([code, name]) => {
    checkerCombinations.push({
      code: code as SupportedLanguage,
      name: name,
      type: "grammar",
      environment,
    });
  });

  // Process speller languages (include all speller languages)
  Object.entries(data.available.speller).forEach(([code, name]) => {
    checkerCombinations.push({
      code: code as SupportedLanguage,
      name: name,
      type: "speller",
      environment,
    });
  });

  return checkerCombinations;
}

/**
 * Validate if a specific checker combination actually works
 * Makes a small test request to verify the endpoint is callable
 */
async function validateCheckerCombination(
  lang: CheckerCombination,
): Promise<boolean> {
  const endpoint = lang.type === "grammar" ? "grammar" : "speller";
  const url = `${API_BASE_URLS[lang.environment]}/${endpoint}/${lang.code}`;

  try {
    // Make a small test request with minimal text
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "test" }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Consider 200-299 as success, 404/500+ as failure
    return response.ok;
  } catch (_error) {
    // Any error (timeout, network, etc.) means this combination doesn't work
    return false;
  }
}

/**
 * Fetch available languages from all API environments (stable, beta, dev)
 * Returns a comprehensive list organized by language, then by environment and checker type
 * Only includes checker combinations that are actually callable
 */
export async function getAvailableCheckerCombinations(): Promise<
  CheckerCombination[]
> {
  const allCheckerCombinations: CheckerCombination[] = [];

  // Fetch from all three environments in parallel
  const environmentPromises = (
    ["stable", "beta", "dev"] as import("./types.ts").ApiEnvironment[]
  ).map(async (environment) => {
    try {
      return await fetchCheckerCombinationsFromEnvironment(environment);
    } catch (error) {
      console.warn(`Failed to fetch from ${environment}:`, error);
      return []; // Return empty array on failure, don't block other environments
    }
  });

  const results = await Promise.all(environmentPromises);

  // Flatten all results
  results.forEach((languageList) => {
    allCheckerCombinations.push(...languageList);
  });

  console.log(
    `🔍 Found ${allCheckerCombinations.length} checker combinations from API endpoints`,
  );

  // Validate each combination in parallel
  console.log("🔍 Validating checker combinations...");
  const validationResults = await Promise.all(
    allCheckerCombinations.map(async (lang) => ({
      lang,
      isValid: await validateCheckerCombination(lang),
    })),
  );

  // Filter to only working combinations
  const workingCheckerCombinations = validationResults
    .filter((result) => result.isValid)
    .map((result) => result.lang);

  // Log which ones failed
  const failedCheckerCombinations = validationResults.filter((result) =>
    !result.isValid
  );
  if (failedCheckerCombinations.length > 0) {
    console.warn(
      `⚠️ ${failedCheckerCombinations.length} checker combinations are not callable:`,
    );
    failedCheckerCombinations.forEach(({ lang }) => {
      console.warn(
        `  ❌ ${lang.code} (${lang.environment} ${lang.type}): ${lang.name}`,
      );
    });
  }

  console.log(
    `✅ ${workingCheckerCombinations.length} checker combinations are working and available`,
  );

  // If no working languages found, return empty array (UI will show error state)
  if (workingCheckerCombinations.length === 0) {
    console.error(
      "❌ No working checker combinations found - API may be down or unreachable",
    );
    return [];
  }

  // Sort by: language code, then environment priority (stable > beta > dev), then type (grammar > speller)
  const envPriority = { stable: 0, beta: 1, dev: 2 };
  const typePriority = { grammar: 0, speller: 1 };

  workingCheckerCombinations.sort((a, b) => {
    // First sort by language code
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    // Then by environment
    if (a.environment !== b.environment) {
      return envPriority[a.environment] - envPriority[b.environment];
    }
    // Finally by type
    return typePriority[a.type] - typePriority[b.type];
  });

  return workingCheckerCombinations;
}

/**
 * Text-to-Speech API for converting text to audio
 */
export class TextToSpeechAPI {
  private readonly baseUrl = "https://api-giellalt.uit.no/tts";
  private readonly timeout = 30000; // 30 seconds for audio generation

  /**
   * Synthesize speech from text
   * @param text The text to convert to speech
   * @param language The language code (e.g., 'se', 'sma', 'smj')
   * @param voice The voice name (e.g., 'biret', 'mahtte', 'sunna')
   * @returns Audio data as a Blob (MP3 format)
   */
  async synthesize(
    text: string,
    language: SupportedLanguage,
    voice: string,
  ): Promise<Blob> {
    if (!text.trim()) {
      throw new Error("Text cannot be empty");
    }

    console.debug(
      `🔊 Synthesizing speech for ${language}/${voice} (${text.length} chars)`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/${language}/${voice}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "audio/mpeg", // Request MP3 format
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Voice "${voice}" for language "${language}" is not available`,
          );
        } else if (response.status >= 500) {
          throw new Error("TTS API server error. Please try again later.");
        } else {
          throw new Error(`TTS request failed with status ${response.status}`);
        }
      }

      const audioBlob = await response.blob();
      console.debug(
        `✅ Synthesized ${audioBlob.size} bytes of audio (${audioBlob.type})`,
      );

      return audioBlob;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout: The TTS synthesis took longer than ${this.timeout}ms`,
          );
        }
        throw error;
      }

      throw new Error(`TTS synthesis failed: ${String(error)}`);
    }
  }
}

/**
 * Validate if a specific TTS voice combination works
 */
async function validateTTSVoice(voice: TTSVoice): Promise<boolean> {
  const url = `https://api-giellalt.uit.no/tts/${voice.code}/${voice.voice}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({ text: "test" }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response.ok;
  } catch (_error) {
    return false;
  }
}

/**
 * Get all available TTS voices from all environments
 * Returns only voices that are actually callable
 */
export async function getAvailableTTSVoices(): Promise<TTSVoice[]> {
  // Hardcoded list from API documentation
  const potentialVoices: TTSVoice[] = [
    // Northern Sami
    {
      code: "se",
      name: "davvisámegiella",
      voice: "biret",
      voiceLabel: "Biret",
      gender: "female",
    },
    {
      code: "se",
      name: "davvisámegiella",
      voice: "mahtte",
      voiceLabel: "Máhtte",
      gender: "male",
    },
    {
      code: "se",
      name: "davvisámegiella",
      voice: "sunna",
      voiceLabel: "Sunná",
      gender: "female",
    },
    // Southern Sami
    {
      code: "sma",
      name: "Åarjelsaemien gïele",
      voice: "aanna",
      voiceLabel: "Aanna",
      gender: "female",
    },
    // Lule Sami
    {
      code: "smj",
      name: "julevsámegiella",
      voice: "abmut",
      voiceLabel: "Ábmut",
      gender: "male",
    },
    {
      code: "smj",
      name: "julevsámegiella",
      voice: "nihkol",
      voiceLabel: "Nihkol",
      gender: "male",
    },
    {
      code: "smj",
      name: "julevsámegiella",
      voice: "sigga",
      voiceLabel: "Siggá",
      gender: "female",
    },
  ];

  console.log(`🔍 Validating ${potentialVoices.length} TTS voices...`);

  // Validate each voice in parallel
  const validationResults = await Promise.all(
    potentialVoices.map(async (voice) => ({
      voice,
      isValid: await validateTTSVoice(voice),
    })),
  );

  // Filter to only working voices
  const workingVoices = validationResults
    .filter((result) => result.isValid)
    .map((result) => result.voice);

  // Log failures
  const failedVoices = validationResults.filter((result) => !result.isValid);
  if (failedVoices.length > 0) {
    console.warn(`⚠️ ${failedVoices.length} TTS voices are not callable:`);
    failedVoices.forEach(({ voice }) => {
      console.warn(`  ❌ ${voice.code}/${voice.voice}: ${voice.voiceLabel}`);
    });
  }

  console.log(
    `✅ ${workingVoices.length} TTS voices are working and available`,
  );

  return workingVoices;
}
