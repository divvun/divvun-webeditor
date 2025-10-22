import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type {
  CheckerApi,
  CheckerResponse,
  SupportedLanguage,
} from "../src/types.ts";
import { TextAnalyzer } from "../src/text-analyzer.ts";
import { LRUCache } from "../src/lru-cache.ts";

/**
 * Mock CheckerApi for testing
 */
class MockCheckerApi implements CheckerApi {
  checkText(
    text: string,
    _language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    return Promise.resolve({ text: text.trim(), errs: [] });
  }

  getSupportedLanguages() {
    return [{ code: "se" as SupportedLanguage, name: "Northern Sámi" }];
  }
}

/**
 * Mock editor interface
 */
class MockEditor {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }

  getLength(): number {
    return this.text.length;
  }
}

Deno.test("Adjust for leading space in text line - error position should be exact", async () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.\n";
  const response = {
    text: text.trim(),
    errs: [
      {
        error_text: "dahkku",
        start_index: 23,
        end_index: 29,
        error_code: "real-ImprtDu1-NSgNom",
        description:
          "Sátni šaddá eará go oaivvilduvvo. Don leat čállán vearba duála imperatiivvas (⁨dahkku⁩). Galgá go substantiiva?",
        suggestions: ["dahku"],
        title: "Konsonántameattáhus",
      },
    ],
  };

  // Create mock API and editor
  const mockApi = new MockCheckerApi();
  const mockEditor = new MockEditor(text);

  // Create TextAnalyzer with callbacks
  const callbacks = {
    onErrorsFound: () => {},
    onUpdateErrorCount: (_count: number) => {},
    onUpdateStatus: (_status: string, _isChecking: boolean) => {},
    onShowErrorMessage: (_message: string) => {},
  };

  const cache: LRUCache<string, CheckerResponse> = new LRUCache(100);
  cache.set(`se:${text}`, response);
  const textAnalyzer = new TextAnalyzer(
    mockApi,
    mockEditor,
    callbacks,
    "se",
    cache,
  );
  // Check the line (line 0 since it's the first line)
  const errors = await textAnalyzer.checkLineForStateManagement(
    0,
  );

  // The API returns error at 23-29 (relative to trimmed text "UNOHAS DAHKU: - Unohas dahkku...")
  // TextAnalyzer should adjust to 24-30 (accounting for leading space in original text)
  assertEquals(errors.length, 1, "Should find 1 error");
  assertEquals(errors[0].error_text, "dahkku", "Error text should be 'dahkku'");

  // Verify TextAnalyzer properly adjusted the indices
  assertEquals(
    errors[0].start_index,
    24,
    "Error should start at index 24 (adjusted)",
  );
  assertEquals(
    errors[0].end_index,
    30,
    "Error should end at index 30 (adjusted)",
  );
});
