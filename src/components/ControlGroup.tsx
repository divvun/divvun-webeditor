export interface ControlGroupProps {
  children: unknown;
}

export default function ControlGroup({ children }: ControlGroupProps) {
  return <div className="flex items-center gap-3 flex-nowrap">{children}</div>;
}
