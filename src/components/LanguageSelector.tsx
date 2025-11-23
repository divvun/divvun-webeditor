import ControlGroup from "./ControlGroup.tsx";

export default function LanguageSelector() {
  // Client-side script to fetch languages and handle changes
  const handleLanguageChange = `
    (function() {
      let availableLanguages = [];
      
      // Function to populate language options with grouping
      async function populateLanguages() {
        const select = document.getElementById('language-select');
        if (!select) return;
        
        try {
          // Import the getAvailableCheckerCombinations function dynamically
          // Note: This function validates each checker combination and only returns working ones
          const { getAvailableCheckerCombinations } = await import('/api.js');
          availableLanguages = await getAvailableCheckerCombinations();
          
          // Check if we got any valid combinations
          if (availableLanguages.length === 0) {
            throw new Error('No working checker combinations available');
          }
          
          // Clear existing options
          select.innerHTML = '';
          
          // Group languages by code
          const languageGroups = {};
          availableLanguages.forEach(lang => {
            if (!languageGroups[lang.code]) {
              languageGroups[lang.code] = {
                name: lang.name,
                variants: []
              };
            }
            languageGroups[lang.code].variants.push(lang);
          });
          
          // Create optgroups for each language
          Object.entries(languageGroups).forEach(([code, data]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = data.name;
            
            // Add variants (stable grammar, stable speller, beta grammar, etc.)
            data.variants.forEach(variant => {
              const option = document.createElement('option');
              // Value format: "code|environment|type"
              option.value = \`\${variant.code}|\${variant.environment}|\${variant.type}\`;
              
              // Display format: "Language Name - stable grammar checker"
              const envLabel = variant.environment === 'stable' ? 'stable' : variant.environment;
              const typeLabel = variant.type === 'grammar' ? 'grammar checker' : 'spell checker';
              option.textContent = \`\${variant.name} - \${envLabel} \${typeLabel}\`;
              
              optgroup.appendChild(option);
            });
            
            select.appendChild(optgroup);
          });
          
          // Get language from URL parameters with smart defaults
          const urlParams = new URLSearchParams(globalThis.location.search);
          const urlLang = urlParams.get('lang') || urlParams.get('language');
          const urlEnv = urlParams.get('environment');
          const urlType = urlParams.get('checkerType');
          
          let initialValue = 'se|stable|grammar'; // default fallback
          
          if (urlLang) {
            // Filter options for this language
            const langOptions = availableLanguages.filter(l => l.code === urlLang);
            
            if (langOptions.length > 0) {
              let selectedOption = null;
              
              // If all params specified, try exact match
              if (urlEnv && urlType) {
                selectedOption = langOptions.find(l => 
                  l.environment === urlEnv && l.type === urlType
                );
              }
              
              // If not found or partial params, apply preferences
              if (!selectedOption) {
                // Preference order: stable > beta > dev, grammar > speller
                const envPriority = { stable: 0, beta: 1, dev: 2 };
                const typePriority = { grammar: 0, speller: 1 };
                
                langOptions.sort((a, b) => {
                  const envDiff = envPriority[a.environment] - envPriority[b.environment];
                  if (envDiff !== 0) return envDiff;
                  return typePriority[a.type] - typePriority[b.type];
                });
                
                selectedOption = langOptions[0];
              }
              
              if (selectedOption) {
                initialValue = \`\${selectedOption.code}|\${selectedOption.environment}|\${selectedOption.type}\`;
              }
            }
          }
          
          select.value = initialValue;
          
        } catch (error) {
          console.error('Failed to load languages:', error);
          
          // Show error state - no fallback
          select.innerHTML = '';
          const option = document.createElement('option');
          option.value = '';
          option.textContent = '❌ No checkers available';
          option.disabled = true;
          select.appendChild(option);
          select.disabled = true;
          
          // Display error message to user
          const statusText = document.getElementById('status-text');
          if (statusText) {
            statusText.innerHTML = '<strong>⚠️ No checker combinations available</strong>';
          }
          
          // Add detailed error below status bar
          const statusDisplay = document.getElementById('status-display');
          if (statusDisplay && statusDisplay.parentElement) {
            const existingWarning = document.getElementById('api-warning');
            if (!existingWarning) {
              const warning = document.createElement('div');
              warning.id = 'api-warning';
              warning.className = 'mt-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm';
              warning.innerHTML = \`
                <p class="font-semibold text-red-800 mb-2">⚠️ Grammar and spell checking is unavailable</p>
                <p class="text-red-700 mb-2">No working checker combinations could be reached. This may be due to:</p>
                <ul class="list-disc list-inside text-red-700 space-y-1 mb-2">
                  <li>Network connectivity issues</li>
                  <li>API services are temporarily down</li>
                  <li>Firewall or proxy blocking access</li>
                </ul>
                <p class="text-red-700"><strong>Suggested actions:</strong> Check your internet connection, try refreshing the page, or visit <a href="https://api.giellalt.org" target="_blank" class="underline">api.giellalt.org</a> to check API status.</p>
              \`;
              statusDisplay.parentElement.appendChild(warning);
            }
          }
        }
      }
      
      // Function to setup event listeners
      function setupEventListeners() {
        const select = document.getElementById('language-select');
        if (!select) return;
        
        select.addEventListener('change', function(e) {
          const selectedValue = e.target.value;
          
          // Parse the value format: "code|environment|type"
          const [code, environment, type] = selectedValue.split('|');
          
          // Update URL with separate parameters
          const url = new URL(globalThis.location.href);
          url.searchParams.set('lang', code);
          url.searchParams.set('environment', environment);
          url.searchParams.set('checkerType', type);
          globalThis.history.pushState({}, '', url);
          
          // Dispatch a custom event that main.ts can listen to
          const event = new CustomEvent('languageChanged', { 
            detail: { 
              language: code,
              environment: environment,
              checkerType: type
            }
          });
          globalThis.dispatchEvent(event);
        });
        
        // Dispatch initial language event for main.ts to pick up
        const initialValue = select.value || 'se|stable|grammar';
        const [code, environment, type] = initialValue.split('|');
        
        const initialEvent = new CustomEvent('languageChanged', { 
          detail: { 
            language: code,
            environment: environment,
            checkerType: type
          }
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
