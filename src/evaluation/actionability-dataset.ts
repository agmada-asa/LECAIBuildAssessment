/**
 * @file Actionability and recoverability corpus derived from message_test_data.
 *
 * The original blind files duplicate these 20 labelled conversations, so this
 * canonical set avoids evaluating the same text twice. Expected assessments
 * test the gate before any task candidate is ranked.
 */

import type { ConversationAssessmentKind, ConversationMessage } from "@/lib/ranking/types";

export type ActionabilityEvaluationCase = {
  id: string;
  difficulty: "easy" | "medium" | "hard" | "impossible" | "random";
  expectedAssessment: Exclude<ConversationAssessmentKind, "undetermined">;
  messages: ConversationMessage[];
};

/** Creates stable canonical messages from the source folder's line-oriented logs. */
function conversation(
  id: string,
  difficulty: ActionabilityEvaluationCase["difficulty"],
  expectedAssessment: ActionabilityEvaluationCase["expectedAssessment"],
  lines: string[],
): ActionabilityEvaluationCase {
  return {
    id,
    difficulty,
    expectedAssessment,
    messages: lines.map((text, index) => ({
      id: `M${index + 1}`,
      text,
      timestamp: `2026-08-14T10:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  };
}

/** Twenty unique cases; the separate blind folder is a shuffled duplicate. */
export const ACTIONABILITY_EVALUATION_DATASET: ActionabilityEvaluationCase[] = [
  conversation("easy-dinner-booking", "easy", "ordinary-conversation", [
    "x: Are we still meeting at the Italian place at 7?",
    "y: Yeah. I booked a table for two under my name.",
    "x: Perfect, I'll leave work around 6:30.",
    "y: Great. See you there.",
  ]),
  conversation("easy-missed-train", "easy", "ordinary-conversation", [
    "x: I missed the 18:12 train.",
    "y: Ah no. When's the next one?",
    "x: 18:42, so I'll be about half an hour late.",
    "y: No problem. I'll wait for you outside the station.",
  ]),
  conversation("easy-code-bug", "easy", "actionable-task", [
    "x: The login endpoint keeps returning 500 when the password is wrong.",
    "y: Check the exception handler. It sounds like the auth error isn't being caught.",
    "x: Yep, that was it. I was only catching ValueError.",
    "y: Nice. Add a test for invalid credentials too.",
  ]),
  conversation("easy-birthday-surprise", "easy", "ordinary-conversation", [
    "x: Don't tell Maya, but everyone is coming over at 8 for her birthday.",
    "y: Got it. Does she still think we're just going out for dinner?",
    "x: Yeah, she has no idea about the surprise.",
    "y: Perfect. I'll bring the cake.",
  ]),
  conversation("medium-parcel", "medium", "actionable-task", [
    "x: It says they tried at 11:24 but nobody rang the bell.",
    "y: Same thing happened last time.",
    "x: I changed it to the shop on King Street.",
    "y: Probably safer. Can you grab it after work?",
    "x: Yeah, assuming they actually leave it there this time.",
  ]),
  conversation("medium-deadline", "medium", "actionable-task", [
    "x: Did you move it?",
    "y: To Monday morning.",
    "x: Thank you. Friday was never realistic after the client changed the scope.",
    "y: I know. Just make sure the final numbers are in before I send it.",
    "x: I'll finish them tonight.",
  ]),
  conversation("medium-concert-ticket", "medium", "ordinary-conversation", [
    "x: I managed to get two in the end.",
    "y: No way, seated or standing?",
    "x: Standing. The site froze twice before payment went through.",
    "y: You're a legend. I'll send you my half now.",
    "x: Don't worry, just do it later.",
  ]),
  conversation("medium-boiler", "medium", "actionable-task", [
    "x: It's doing that thing again.",
    "y: Pressure dropped?",
    "x: Just under one.",
    "y: Try the little valve underneath, but stop when it gets to about 1.5.",
    "x: Okay. Last time that fixed it for a few days.",
  ]),
  conversation("hard-left-behind", "hard", "actionable-task", [
    "x: You still have mine, right?",
    "y: I think so. The black one?",
    "x: No, the other one.",
    "y: Oh. Then maybe it's still in the car.",
    "x: Can you check before tomorrow?",
    "y: Yeah.",
  ]),
  conversation("hard-changed-plan", "hard", "insufficient-context", [
    "x: So we're not doing it there anymore?",
    "y: Apparently not.",
    "x: Because of what happened Tuesday?",
    "y: That's what I heard.",
    "x: Does Sam know?",
    "y: I assumed you told him.",
    "x: I haven't spoken to him since then.",
  ]),
  conversation("hard-payment-or-booking", "hard", "ordinary-conversation", [
    "x: It finally went through.",
    "y: Full amount?",
    "x: Yeah, but it took it twice at first.",
    "y: Has one disappeared?",
    "x: One is still pending.",
    "y: I'd give it a day before calling them.",
  ]),
  conversation("hard-returning-somewhere", "hard", "ordinary-conversation", [
    "x: I don't really want to go back.",
    "y: You said that last time.",
    "x: I know, but now there's actually a reason.",
    "y: Are you going to tell them?",
    "x: Maybe after tomorrow.",
    "y: That's probably better.",
  ]),
  conversation("impossible-pronoun-only", "impossible", "insufficient-context", [
    "x: Did you do it?", "y: Yeah.", "x: And?", "y: Pretty much what we expected.",
    "x: Okay. Tell me later.", "y: Sure.",
  ]),
  conversation("impossible-generic-arrangement", "impossible", "insufficient-context", [
    "x: Tomorrow still works?", "y: Should do.", "x: Same place?",
    "y: Unless you want to change it.", "x: No, that's fine.", "y: Cool.",
  ]),
  conversation("impossible-unknown-object", "impossible", "insufficient-context", [
    "x: I found it.", "y: Where was it?", "x: Where you said.", "y: I knew it.",
    "x: Do you still need it?", "y: Not today.",
  ]),
  conversation("impossible-ambiguous-event", "impossible", "insufficient-context", [
    "x: That was worse than last time.", "y: I thought it was better.", "x: Seriously?",
    "y: Yeah, apart from the ending.", "x: Fair.", "y: Would you do it again?", "x: Maybe.",
  ]),
  conversation("random-blue-calendar", "random", "insufficient-context", [
    "x: The blue calendar forgot seven.", "y: I don't eat windows after Thursday.",
    "x: 8841.", "y: Purple?", "x: The staircase has Wi-Fi.",
    "y: Correct horse battery soup.",
  ]),
  conversation("random-banana-torque", "random", "insufficient-context", [
    "x: banana torque satellite", "y: 14 14 903 maybe glass",
    "x: The dentist is louder than algebra.", "y: qqqq tomorrow engine spoon",
    "x: £7.41 north triangle", "y: absolutely not refrigerator.",
  ]),
  conversation("random-report-penguins", "random", "insufficient-context", [
    "x: I finished the report.", "y: Penguins can jump higher than invoices.",
    "x: My left shoe is at 63%.", "y: Tuesday.",
    "x: Are you bringing the screwdriver?", "y: Beethoven was probably not a postcode.",
  ]),
  conversation("random-cloud-lamp", "random", "insufficient-context", [
    "x: 991002", "y: cloud cloud lamp", "x: Why?",
    "y: seventeen kilometres of orange", "x: ok", "y: JF8#2 banana north north",
  ]),
];
