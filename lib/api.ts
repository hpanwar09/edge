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

    const report: EdgeReport = {
      graph,
      orphans: this.detectOrphans(graph),
      fileTypes,
    };

    if (this.config.includeCycles) {
      report.cycles = this.detectCycles(graph);
    }

    return report;
  }

  private detectOrphans(graph: EdgeReport["graph"]): string[] {
    const inboundCounts = Object.keys(graph).reduce<Record<string, number>>(
      (counts, node) => {
        counts[node] = 0;
        return counts;
      },
      {}
    );

    Object.values(graph).forEach((dependencies) => {
      dependencies.forEach((dependency) => {
        inboundCounts[dependency] = (inboundCounts[dependency] ?? 0) + 1;
      });
    });

    return Object.entries(inboundCounts)
      .filter(([, inboundCount]) => inboundCount === 0)
      .map(([node]) => node)
      .sort((left, right) => left.localeCompare(right));
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
