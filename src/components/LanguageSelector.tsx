import ControlGroup from "./ControlGroup.tsx";

export default function LanguageSelector() {
  return (
    <ControlGroup>
      <label htmlFor="language-select">Language:</label>
      <select id="language-select">
        <option value="se">Davvisámegiella (Northern sami)</option>
        <option value="sma">Åarjelsaemien (Southern sami)</option>
        <option value="smj">Julevsámegiella (Lule sami)</option>
        <option value="smn">Anarâškielâ (Inari sami)</option>
        <option value="sms">Nuõrttsääʹmǩiõll (Skolt sami)</option>
      </select>
    </ControlGroup>
  );
}