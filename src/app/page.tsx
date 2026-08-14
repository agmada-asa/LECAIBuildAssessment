/** @file Server-rendered entry point for the interactive intent workbench. */

import { IntentRanker } from "@/components/intent-ranker";

/** Renders the single assessment workbench route. */
export default function Home() {
  return <IntentRanker />;
}
