/**
 * The messages that `transcript-verification` sends: the assessment method and the
 * shape of the reply (technical-design.md §5, `transcript-verification` and "Where
 * prompts live").
 */

import type OpenAI from "openai";

/**
 * The assessment method. It is the prompt that made the assessments in
 * `docs/quality/`, copied word for word. Those assessments are the measure for
 * each change to this stage (technical-design.md §5, `transcript-verification`).
 * After a change to the assessment method, read the assessments again.
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
 * The shape of the reply, stated in the prompt. It is the only text that the
 * system message adds to the assessment method, and it adds no judgement. It maps
 * the words of the method to the deficiency types that every checker uses
 * (technical-design.md §5, `qa-loop`).
 * JSON mode does not fix the shape, and a JSON-mode call must also ask for JSON in
 * its messages (technical-design.md §6).
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

/* jscpd:ignore-start -- the division stages build their messages in the same
   shape. This stage keeps its code with no change until the stage is deleted. */
/**
 * Builds the messages of the one model call of `transcript-verification`.
 *
 * @param args - The transcript and the structured transcript.
 * @param args.transcriptText - The transcript from `transcription`.
 * @param args.structuredTranscriptText - The structured transcript from `transcript-structuring`.
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
/* jscpd:ignore-end */
