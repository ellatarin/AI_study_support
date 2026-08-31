/**
 * Stage 4's prompt: the fidelity-assessment method, stated as chat messages.
 *
 * Kept beside the stage rather than inside it so that prompt changes — the part
 * iterated on hardest once real lectures run — read as their own diffs
 * (technical-design.md §5, "Where prompts live").
 */

import type OpenAI from "openai";

/**
 * The assessment method, exactly as it was written by hand.
 *
 * This is the prompt that produced the assessments committed in `docs/quality/`,
 * carried over word for word. It is quoted rather than paraphrased because those
 * assessments are the calibration corpus every later change to this stage is
 * measured against: reword the method and the corpus stops describing what the
 * stage does, so a change in the findings could no longer be attributed to the
 * change that caused it (technical-design.md §5, Stage 4).
 *
 * Edit it only deliberately, and expect to re-read the corpus when you do.
 */
const ASSESSMENT_METHOD = `I want you to make a detailed assessment of the structured transcript and transcript files to see if any concepts have been lost or underexplained in the structured version. Please make a report.
Approach:
•    Read the transcript in full.
•    Segment it into topic blocks and build a concept inventory: each distinct claim, mechanism, example, number, caveat, or piece of clinical/exam framing.
•    Diff that inventory against the structured version, classifying each item as: preserved, compressed but intact, underexplained (present but stripped of the mechanism or reasoning that makes it usable), lost, or distorted (structured version asserts something the source doesn't support — worth flagging separately since it's the highest-risk category).
•    Also check the reverse direction: anything in the structured version with no basis in the transcript.
•    Report ordered by severity, with a source quote-fragment or locator for each finding
•    treat lost lecturer asides, repetition, and admin chatter as non-findings, but flag lost examples and numbers even where the concept survives, since those tend to matter for revision. Don't rewrite or patch the structured document — assessment only.
`;

/**
 * The reply contract, restated in the prompt.
 *
 * The only thing appended to the method above, and it adds no judgement: it says
 * how to write down findings the method has already decided on. The category
 * names translate the method's own words into the shared vocabulary every
 * checker reports in — "lost" is an `omission`, the reverse-direction check
 * yields an `unsourced-addition` — so two stages cannot end up naming the same
 * fault differently (`QaDeficiencyType`, technical-design.md Stage 8). The prose
 * categories that union also carries are deliberately absent: this call compares
 * two transcripts and has no notes to judge the writing of.
 *
 * JSON mode alone does not guarantee the shape, and OpenRouter documents that a
 * JSON-mode call must ask for JSON in its messages too (technical-design.md §6).
 */
const REPLY_CONTRACT = `Reply with a single JSON object and nothing else, in this exact shape:

{
  "overallVerdict": "pass" or "fail",
  "coverageScore": number from 0 to 100,
  "deficiencies": [
    {
      "severity": "critical" or "major" or "minor",
      "type": "omission" or "underexplained" or "distortion" or "unsourced-addition" or "other",
      "description": string,
      "source": { "evidence": string, "location": string } or null,
      "suggestedFix": string,
      "outputLocation": string
    }
  ],
  "considered": [
    { "source": { "evidence": string, "location": string }, "whyNotRaised": string }
  ]
}

How your classification maps onto "type":
- lost -> "omission"
- underexplained -> "underexplained"
- distorted -> "distortion"
- anything in the structured version with no basis in the transcript -> "unsourced-addition"
- a real finding none of those fit -> "other", and say in "description" what category it needed
Items you classify as preserved or as compressed but intact are not findings and do not appear in "deficiencies".

"source" carries the quote-fragment or locator for the passage in the transcript, and "outputLocation" says where in the structured version the fault sits, or where the missing content belongs. An "unsourced-addition" has no source passage by definition, so its "source" is null.

"considered" is for what you examined and decided was not a finding — the lost asides, repetition and admin chatter the method tells you to pass over. Recording them is what distinguishes a check that looked from one that missed.

Order "deficiencies" by severity, most severe first.`;

/**
 * Builds the messages for Stage 4's single call.
 *
 * @param args - The two versions being compared.
 * @param args.transcriptText - The raw transcript from Stage 2.
 * @param args.structuredTranscriptText - The structured transcript from Stage 3.
 * @returns The chat messages to send.
 */
export function buildVerificationMessages({
	transcriptText,
	structuredTranscriptText,
}: {
	readonly transcriptText: string;
	readonly structuredTranscriptText: string;
}): readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: `${ASSESSMENT_METHOD}\n\n${REPLY_CONTRACT}` },
		{
			role: "user",
			content: `Transcript:\n${transcriptText}\n\n---\n\nStructured transcript:\n${structuredTranscriptText}`,
		},
	];
}
