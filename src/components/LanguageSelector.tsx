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
          // Import the getAvailableLanguages function dynamically
          const { getAvailableLanguages } = await import('/api.js');
          availableLanguages = await getAvailableLanguages();
          
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
          console.warn('Failed to load languages, using fallback:', error);
          // Fallback options
          select.innerHTML = '';
          
          const optgroup = document.createElement('optgroup');
          optgroup.label = 'Davvisámegiella (Northern sami)';
          const option1 = document.createElement('option');
          option1.value = 'se|stable|grammar';
          option1.textContent = 'Davvisámegiella (Northern sami) - stable grammar checker';
          optgroup.appendChild(option1);
          select.appendChild(optgroup);
          
          const optgroup2 = document.createElement('optgroup');
          optgroup2.label = 'Nuõrttsääʹmǩiõll (Skolt sami)';
          const option2 = document.createElement('option');
          option2.value = 'sms|stable|speller';
          option2.textContent = 'Nuõrttsääʹmǩiõll (Skolt sami) - stable spell checker';
          optgroup2.appendChild(option2);
          select.appendChild(optgroup2);
          
          select.value = 'se|stable|grammar';
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
