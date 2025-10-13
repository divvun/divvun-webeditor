export interface ControlsProps {
  children: unknown;
}

export default function Controls({ children }: ControlsProps) {
  return <div className="controls">{children}</div>;
}