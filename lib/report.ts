export interface EdgeReport {
  graph: { [path: string]: string[] };
  orphanCount: number;
  cycles?: string[][];
  fileTypes: { [extension: string]: number };
}
