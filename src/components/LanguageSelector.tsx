import ControlGroup from "./ControlGroup.tsx";

export default function LanguageSelector() {
  // Client-side script to fetch languages and handle changes
  const handleLanguageChange = `
    (function() {
      let availableLanguages = [];
      
      // Function to populate language options
      async function populateLanguages() {
        const select = document.getElementById('language-select');
        if (!select) return;
        
        try {
          // Import the getAvailableLanguages function dynamically
          const { getAvailableLanguages } = await import('/api.js');
          availableLanguages = await getAvailableLanguages();
          
          // Clear existing options
          select.innerHTML = '';
          
          // Add language options
          availableLanguages.forEach(language => {
            const option = document.createElement('option');
            option.value = language.code;
            option.textContent = language.name;
            select.appendChild(option);
          });
          
          // Get language from URL parameter or use default 'se'
          const urlParams = new URLSearchParams(globalThis.location.search);
          const urlLang = urlParams.get('lang') || urlParams.get('language');
          const initialLanguage = urlLang && availableLanguages.some(l => l.code === urlLang) 
            ? urlLang 
            : 'se';
          
          select.value = initialLanguage;
          
        } catch (error) {
          console.warn('Failed to load languages, using fallback:', error);
          // Fallback options
          const fallbackOptions = [
            { code: 'se', name: 'Davvisámegiella (Northern sami)' },
            { code: 'sms', name: 'Nuõrttsääʹmǩiõll (Skolt sami)' }
          ];
          
          select.innerHTML = '';
          fallbackOptions.forEach(language => {
            const option = document.createElement('option');
            option.value = language.code;
            option.textContent = language.name;
            select.appendChild(option);
          });
          
          // Get language from URL parameter or use default 'se'
          const urlParams = new URLSearchParams(globalThis.location.search);
          const urlLang = urlParams.get('lang') || urlParams.get('language');
          const initialLanguage = urlLang && fallbackOptions.some(l => l.code === urlLang) 
            ? urlLang 
            : 'se';
          
          select.value = initialLanguage;
        }
      }
      
      // Function to setup event listeners
      function setupEventListeners() {
        const select = document.getElementById('language-select');
        if (!select) return;
        
        select.addEventListener('change', function(e) {
          const selectedLanguage = e.target.value;
          
          // Update URL with the selected language
          const url = new URL(globalThis.location.href);
          url.searchParams.set('lang', selectedLanguage);
          globalThis.history.pushState({}, '', url);
          
          // Dispatch a custom event that main.ts can listen to
          const event = new CustomEvent('languageChanged', { 
            detail: { language: selectedLanguage }
          });
          globalThis.dispatchEvent(event);
        });
        
        // Dispatch initial language event for main.ts to pick up
        const initialEvent = new CustomEvent('languageChanged', { 
          detail: { language: select.value || 'se' }
        });
        // Delay to ensure main.ts is ready
        setTimeout(() => {
          globalThis.dispatchEvent(initialEvent);
        }, 100);
      }
      
      // Initialize when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
          await populateLanguages();
          setupEventListeners();
        });
      } else {
        populateLanguages().then(() => {
          setupEventListeners();
        });
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
        {/* Options will be populated dynamically */}
        <option value="se">Loading...</option>
      </select>
      {/* Inline script to handle language changes */}
      <script dangerouslySetInnerHTML={{ __html: handleLanguageChange }} />
    </ControlGroup>
  );
}
