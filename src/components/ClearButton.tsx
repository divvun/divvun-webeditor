import ControlGroup from "./ControlGroup.tsx";

export default function ClearButton() {
  return (
    <ControlGroup>
      <button
        type="button"
        id="clear-btn"
        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
      >
        Clear
      </button>
    </ControlGroup>
  );
}
