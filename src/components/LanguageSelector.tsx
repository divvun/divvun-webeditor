import ControlGroup from "./ControlGroup.tsx";

export default function LanguageSelector() {
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
        className="block w-full sm:w-auto px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
      >
        <option value="se">Davvisámegiella (Northern sami)</option>
        <option value="sma">Åarjelsaemien (Southern sami)</option>
        <option value="smj">Julevsámegiella (Lule sami)</option>
        <option value="smn">Anarâškielâ (Inari sami)</option>
        <option value="sms">Nuõrttsääʹmǩiõll (Skolt sami)</option>
      </select>
    </ControlGroup>
  );
}
