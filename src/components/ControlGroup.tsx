export interface ControlGroupProps {
  children: unknown;
}

export default function ControlGroup({ children }: ControlGroupProps) {
  return <div className="control-group">{children}</div>;
}