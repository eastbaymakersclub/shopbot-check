# ShopBot Check

Browser-based visualization and static preflight for ShopBot OpenSBP (`.sbp`) programs, built by [East Bay Makers Club](https://eastbaymakersclub.com/) for its PRSalpha 96 × 48.

Drop in a part file to get an interactive 3D toolpath, machine-travel and stock-contact checks, setup warnings, and a conservative feeds-and-speeds review. Files are analyzed locally in a Web Worker and never leave the browser.

> **Preflight aid, not a safety guarantee.** Fixtures, workholding, cutter condition, tool stick-out, machine state, and the physical setup still require an operator check.

## What it checks

- 3D move, jog, and arc visualization with selectable findings
- EBMC machine travel limits: X −0.5…96.5, Y −0.5…48.5, Z −2…8 inches
- machine-coordinate work-zero placement against machine travel, including negative file coordinates
- configurable rectangular stock position and size, with cutter-radius overhang allowance and stock-safe work-zero ranges
- rapid moves that enter material, Z travel, and cuts more than 0.02 inches beneath the modeled stock
- absolute mode, explicit units, move speeds, spindle RPM, spindle sequencing, and software limit-check commands
- unexpected machine-global setting commands
- chip load (`feed / (RPM × flutes)`) with material, cutter, and pass-depth adjustment
- numerical starting feed bands and conservative pass/plunge recommendations
- structured Fusion tool and rectangular stock metadata from the optional VirtualCut ShopBot post patch
- VirtualCut Fusion post-version checks that flag older or unversioned VirtualCut output

The initial parser boundary is intentionally narrow: it fully analyzes the OpenSBP constructs used by EBMC’s August 2026 sample corpus and fails closed on anything unresolved. Supported constructs include assignments, the standard unit guard, `SA`, `CN 90/91`, `C6/C7/C9`, `TR`, `MS`, `PAUSE`, `JZ/J2/J3`, `M2/M3`, `CG`, `SF`, labels, and `END`.

## Defaults and sources

- machine limits and jog/move defaults come from EBMC’s August 12, 2026 ShopBot settings backup
- default stock is 0.7-inch soft plywood with stock-surface Z zero
- default cutter is a 1/2-inch, two-flute compression cutter; a 3/8-inch compression cutter and the cutters observed in the sample corpus are included as presets
- chip-load calculations and the deeper-pass reductions follow ShopBot’s published [Feeds and Speeds Charts](https://shopbottools.com/wp-content/uploads/2024/01/FeedsandSpeeds.pdf)
- parser semantics are grounded in ShopBot’s [OpenSBP Command Reference](https://shopbottools.com/wp-content/uploads/2024/01/SBG00253150707CommandRefV3.pdf)
- the interaction model takes inspiration from [CNCjs](https://github.com/cncjs/cncjs), while the OpenSBP parser and viewer are purpose-built for this project

Manufacturer guidance for the exact cutter always takes precedence over a generic starting band.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

Synthetic, non-member fixtures live in `tests/fixtures`. To run the same parser contract against a private local corpus without adding those files to Git:

```bash
SBP_SAMPLE_DIR=/absolute/path/to/sbp-files npm test
```

## Fusion post integration

The public app includes a browser-only builder for the VirtualCut edition of Autodesk's ShopBot OpenSBP post. It adds inert comments for tool number, diameter, units, flute count, type, flute length, description, comment, vendor, and product ID at each tool change. It also records the modeled rectangular stock bounding box, stock units, work-relative position, Z-zero convention, and VirtualCut post version once per file. The analyzer loads those values into the editable Job setup and warns when a file identifies an older or unversioned VirtualCut post.

Autodesk's original post is not stored or redistributed by this project. Members download it directly from Autodesk, then choose that local `.cps` file in VirtualCut. The patch and generated download remain in the browser. Review Autodesk's terms and carefully test any customized post before using it on a machine.

## Architecture

- React 19 and TypeScript
- vinext/Vite application shell
- Three.js toolpath renderer
- Web Worker parser and validator
- Vitest unit and private-corpus contract tests
- no database, server analysis, account, upload, or telemetry

## Deployment

Production is deployed to Cloudflare Workers at
[virtualcut.eastbaymakersclub.com](https://virtualcut.eastbaymakersclub.com/).
Cloudflare Workers Builds tracks the `main` branch. Its build command is
`npm run build`, and its deploy command is
`npx wrangler deploy --config dist/server/wrangler.json`.

For an authenticated local deployment, run `npm run deploy:cloudflare`.

## Contributing

Please open an issue with a minimal synthetic `.sbp` example when proposing support for a new OpenSBP construct. Do not attach member or production design files unless you have permission to publish them.

## License

[MIT](LICENSE)
