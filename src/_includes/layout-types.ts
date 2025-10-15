export interface GitInfo {
  fullHash: string;
  shortHash: string;
  timestamp: string;
}

export interface LayoutProps {
  title: string;
  description?: string;
  children: unknown;
  git?: GitInfo;
}
