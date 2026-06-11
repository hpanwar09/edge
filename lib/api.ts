import { EdgeReport } from "./report.ts";
import { MultiLanguageScanner } from "./scanner.ts";

export interface EdgeConfig {
  extensions?: string[];
  includeCycles?: boolean;
}

const defaultConfig: EdgeConfig = {
  extensions: ["rb", "slim", "js", "jsx", "ts", "tsx"],
  includeCycles: true,
};

export class Edge {
  private readonly config: EdgeConfig;

  constructor(private path: string, config: EdgeConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  async analyze(): Promise<EdgeReport> {
    const scanner = new MultiLanguageScanner(this.path, {
      extensions: this.config.extensions,
    });
    const { graph, fileTypes } = await scanner.scan();

    const { connectedGraph, orphanCount } = this.separateOrphans(graph);

    const report: EdgeReport = {
      graph: connectedGraph,
      orphanCount,
      fileTypes,
    };

    if (this.config.includeCycles) {
      report.cycles = this.detectCycles(graph);
    }

    return report;
  }

  private separateOrphans(graph: EdgeReport["graph"]): {
    connectedGraph: EdgeReport["graph"];
    orphanCount: number;
  } {
    const hasInbound = new Set<string>();
    for (const deps of Object.values(graph)) {
      for (const dep of deps) {
        hasInbound.add(dep);
      }
    }

    const connectedGraph: EdgeReport["graph"] = {};
    let orphanCount = 0;

    for (const [node, deps] of Object.entries(graph)) {
      if (deps.length > 0 || hasInbound.has(node)) {
        connectedGraph[node] = deps;
      } else {
        orphanCount++;
      }
    }

    return { connectedGraph, orphanCount };
  }

  private detectCycles(graph: EdgeReport["graph"]): string[][] {
    const adjacencyList = graph;

    const visited = new Set();
    const stack = new Set();
    const cycles: string[][] = [];

    function dfs(node: string, path: string[] = []) {
      if (stack.has(node)) {
        // Found a cycle
        const cycleStartIndex = path.indexOf(node);
        const cycle = path.slice(cycleStartIndex);
        cycles.push(cycle);
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);
      path.push(node);

      (adjacencyList[node] || []).forEach((neighbor) => {
        dfs(neighbor, path);
      });

      stack.delete(node);
      path.pop();
    }

    Object.keys(graph).forEach((node) => {
      if (!visited.has(node)) {
        dfs(node);
      }
    });

    return cycles;
  }
}
