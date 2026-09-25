/**
 * Route segment config shared by every page through `export * from "@/lib/segment-config"`.
 *
 * Live mode keeps the pages fully dynamic (every request hits the API), while
 * the static export needs them prerendered. Next only accepts *literal* values
 * for `export const dynamic = ...` written in the page file itself — a
 * conditional there is reported as a build error by its static analyzer — but a
 * star re-export is not inspected, and the value the build actually applies is
 * read from the loaded page module. So the mode switch lives here, once.
 */
import { IS_STATIC } from "./static";

export const dynamic = IS_STATIC ? "force-static" : "force-dynamic";
