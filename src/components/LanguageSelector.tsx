import ControlGroup from "./ControlGroup.tsx";
import { GrammarCheckerAPI, SpellCheckerAPI } from "../api.ts";

export default function LanguageSelector() {
  // Get supported languages from both APIs
  const grammarApi = new GrammarCheckerAPI();
  const spellApi = new SpellCheckerAPI();

  const grammarLanguages = grammarApi.getSupportedLanguages();
  const spellLanguages = spellApi.getSupportedLanguages();

  // Combine all supported languages
  const allLanguages = [...grammarLanguages, ...spellLanguages];

  // Sort by language code for consistent ordering
  allLanguages.sort((a, b) => a.code.localeCompare(b.code));

  // Client-side script to handle language changes
  const handleLanguageChange = `
    (function() {
      const select = document.getElementById('language-select');
      if (select) {
        select.addEventListener('change', function(e) {
          const selectedLanguage = e.target.value;
          // Dispatch a custom event that main.ts can listen to
          const event = new CustomEvent('languageChanged', { 
            detail: { language: selectedLanguage }
          });
          globalThis.dispatchEvent(event);
        });
        
        // Set initial value to 'se' (Northern Sami) as default
        select.value = 'se';
        
        // Also dispatch initial language event for main.ts to pick up
        const initialEvent = new CustomEvent('languageChanged', { 
          detail: { language: 'se' }
        });
        // Delay to ensure main.ts is ready
        setTimeout(() => {
          globalThis.dispatchEvent(initialEvent);
        }, 100);
      }
    })();
  `;

  return (
    <ControlGroup>
      <label
        htmlFor="language-select"
        className="text-sm font-medium text-gray-700 whitespace-nowrap"
      >
        Language:
      </label>
      <select
        id="language-select"
        className="px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-0 flex-shrink-0"
      >
        {allLanguages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.name}
          </option>
        ))}
      </select>
      {/* Inline script to handle language changes */}
      <script dangerouslySetInnerHTML={{ __html: handleLanguageChange }} />
    </ControlGroup>
  );
}
