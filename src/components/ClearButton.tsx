import ControlGroup from "./ControlGroup.tsx";

export default function ClearButton() {
  // Client-side script to set button color
  const setButtonColor = `
    (function() {
      const btn = document.getElementById('clear-btn');
      if (btn) {
        btn.style.backgroundColor = '#10b981';
      }
    })();
  `;

  return (
    <ControlGroup>
      <button
        type="button"
        id="clear-btn"
        className="px-4 py-2 text-white font-medium rounded-lg shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2"
      >
        Clear
      </button>
      <script dangerouslySetInnerHTML={{ __html: setButtonColor }} />
    </ControlGroup>
  );
}
