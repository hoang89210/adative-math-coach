import { resetRunManifest } from "./helpers";

/** Initialize an empty per-run manifest so teardown only deletes items from THIS run. */
export default async function globalSetup() {
  resetRunManifest();
}
