import { Edge, EdgeConfig } from "../lib/api.ts";
import { parseArgs, ParseOptions } from "@std/cli/parse-args";

async function main() {
  const args = parseArguments(Deno.args);
  const path = args._[0];

  if (!path) {
    console.error("ERROR: No path supplied for analysis.");
    return Deno.exit(1);
  }

  const config: EdgeConfig = {};

  // Extensions arg is a comma-separated string like: js,tsx,jsx
  if (args.extensions) {
    config.extensions = args.extensions
      .split(",")
      .map((extension: string) => extension.trim())
      .filter(Boolean);
  }

  const edge = new Edge(path.toString(), config);
  const report = await edge.analyze();

  const encoder = new TextEncoder();

  if (args.json) {
    Deno.writeFileSync(
      "edge_analysis.json",
      encoder.encode(JSON.stringify(report))
    );
  }

  if (args.html) {
    const template = Deno.readTextFileSync("view-report.html");
    const dataScript = `<script>window.report = ${JSON.stringify(
      report
    )};</script>`;
    // Inject data script right before the first <script tag
    const output = template.replace("<script", `${dataScript}\n  <script`);
    Deno.writeFileSync("edge_analysis.html", encoder.encode(output));
  }

  if (args.open) {
    const command = new Deno.Command("open", { args: ["edge_analysis.html"] });
    await command.output();
  }
}

function parseArguments(args: string[]) {
  const options: ParseOptions = {
    boolean: ["html", "json", "open"],
    string: ["extensions"],
  };
  return parseArgs(args, options);
}

main();
