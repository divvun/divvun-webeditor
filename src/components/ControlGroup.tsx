export interface ControlGroupProps {
  children: unknown;
}

export default function ControlGroup({ children }: ControlGroupProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      {children}
    </div>
  );
}
