export interface EdgeReport {
  graph: { [path: string]: string[] };
  orphans: string[];
  cycles?: string[][];
  fileTypes: { [extension: string]: number };
}
