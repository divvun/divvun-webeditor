export interface ControlsProps {
  children: unknown;
}

export default function Controls({ children }: ControlsProps) {
  return (
    <div className="bg-gray-50 border-b border-gray-200 p-6">
      <div className="flex flex-wrap gap-4 items-center">{children}</div>
    </div>
  );
}
