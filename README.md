# Edge

A multi-language dependency graph and circular dependency detector for your codebase.

![](docs/demo.png) _Github Desktop codebase when visualised with Edge_

## Supported Languages

- **Ruby** (`.rb`) — `require`, `require_relative`, `autoload`, `load`
- **Slim** (`.slim`) — `render` partials and ViewComponent renders
- **JavaScript** (`.js`, `.jsx`) — ES `import` and CommonJS `require`
- **TypeScript** (`.ts`, `.tsx`) — ES `import` and CommonJS `require`

## How to use

1. Clone this repo
2. Have [Deno](https://deno.com/) installed
3. Run:
   ```sh
   deno run --allow-read --allow-write --allow-run bin/cli.ts <path_to_your_codebase> --html --open
   ```
4. The report opens in your browser as `edge_analysis.html`

### Options

| Flag                    | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `--html`                | Generate an interactive HTML report                           |
| `--json`                | Generate a JSON report (`edge_analysis.json`)                 |
| `--open`                | Open the HTML report in your default browser                  |
| `--extensions rb,js,ts` | Only scan specific file types (comma-separated, default: all) |

### Examples

```sh
# Scan everything
deno run --allow-read --allow-write --allow-run bin/cli.ts ./my-project --html --open

# Ruby only
deno run --allow-read --allow-write --allow-run bin/cli.ts ./my-rails-app --html --open --extensions rb

# JavaScript/TypeScript only
deno run --allow-read --allow-write --allow-run bin/cli.ts ./my-frontend --html --open --extensions js,jsx,ts,tsx
```

## Features

- **Circular dependency detection** — finds and highlights import cycles
- **File type filters** — toggle visibility by language with color-coded nodes
- **Canvas renderer** — handles 10,000+ node graphs smoothly
- **Quadtree hit-testing** — fast hover/click on large graphs
- **Multiple display modes** — Cycles Only, Connected Only, Full Graph, Orphans Only
- **Search** — find files by name in the interactive viewer
