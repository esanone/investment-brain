/**
 * Segment config for the `[param]` routes (`/companies/[ticker]`, `/themes/[id]`),
 * re-exported with `export *` for the same reason as segment-config.ts.
 *
 * In the static export every page comes from `generateStaticParams` and an
 * unknown param is a 404 (`dynamicParams: false`, which `output: "export"`
 * requires); live mode keeps Next's default of rendering any param on demand.
 */
import { IS_STATIC } from "./static";

export { dynamic } from "./segment-config";
export const dynamicParams = IS_STATIC ? false : true;
