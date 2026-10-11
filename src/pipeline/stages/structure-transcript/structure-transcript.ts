/**
 * The `structure-transcript` stage. It writes the lecture title, the topics and
 * their subtopics, each subtopic with its own text, into one file. It calls no
 * model (technical-design.md §5, `structure-transcript`).
 */

import type { Logger } from "pino";
import type { PipelineStage } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { createPipelineStage, writeJsonStageResult } from "../pipeline-stage.js";
import { readTopicsWithSubtopics } from "../stage-input.js";
import type { StructuredTranscript, TopicWithSubtopics } from "../structured-transcript.js";

const STAGE_ID = "structure-transcript";

/** The error when the transcript, the retitled subtopics or the topics are missing or unreadable. */
export class StructureTranscriptError extends NamedError {}

/**
 * Builds the `structure-transcript` stage.
 *
 * @param args - The dependencies of the stage.
 * @param args.logger - The logger of the invocation.
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only gives the logger to the stage.
export function createStructureTranscriptStage({
	logger,
}: {
	readonly logger: Logger;
}): PipelineStage<readonly TopicWithSubtopics[], StructuredTranscript> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: (context) =>
			readTopicsWithSubtopics({
				context,
				purpose: "structure",
				fail: (message) => new StructureTranscriptError(message),
			}),
		run: ({ input, context }) =>
			writeJsonStageResult({
				stageId: STAGE_ID,
				context,
				output: { lectureTitle: context.lectureTitle, topics: input },
			}),
	});
}
