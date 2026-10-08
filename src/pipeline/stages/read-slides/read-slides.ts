/**
 * The `read-slides` stage. A vision model reads each slide image and gives one
 * slide reading (technical-design.md §5, `read-slides`).
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { configuredStage } from "../../../utils/stage-config.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { readOrMakeSavedFiles } from "../saved-files.js";
import {
	findSlideImages,
	isSlideReading,
	isSlideReadingReply,
	type SlideReading,
	type SlideReadingReply,
	slideReadingPath,
} from "../slides.js";
import { buildSlideReadingMessages, FIGURE_TYPES, SLIDE_KIND_RULES } from "./read-slides.prompt.js";

/**
 * The error when the slide images are missing, or when a saved slide reading is
 * unreadable. A slide whose third send is still unusable fails the stage with
 * `ResendsExhaustedError`.
 */
export class ReadSlidesError extends NamedError {}

const STAGE_ID = "read-slides";

type SlideImages = {
	/** The absolute path of each slide image, in deck order. */
	readonly slideImagePaths: readonly string[];
};

/** The output of `read-slides`. */
export type ReadSlidesOutput = {
	/** The reading of each slide, in deck order. */
	readonly readings: readonly SlideReading[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ title, body, tables, figures, caption, kind } object";

/**
 * Makes the slide reading from a reply, or gives the reason that the reply is
 * unusable (technical-design.md §5, `read-slides`).
 *
 * @param args - The reply, and the slide that it reads.
 * @param args.reply - The parsed reply, with the documented fields and types.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The slide reading, or the reason that the reply is unusable.
 */
function usableReading({
	reply,
	slideNumber,
}: {
	readonly reply: SlideReadingReply;
	readonly slideNumber: number;
}): { readonly reply: SlideReading } | { readonly failure: string } {
	if (reply.caption.trim() === "") {
		return { failure: "The model's reply gives an empty caption" };
	}
	if (!Object.hasOwn(SLIDE_KIND_RULES, reply.kind)) {
		return { failure: `The model's reply gives the unknown kind "${reply.kind}"` };
	}
	const unknownFigure = reply.figures.find(
		(figure) => !(FIGURE_TYPES as readonly string[]).includes(figure.type),
	);
	if (unknownFigure !== undefined) {
		return { failure: `The model's reply gives the unknown figure type "${unknownFigure.type}"` };
	}
	return { reply: { slideNumber, ...reply } };
}

/**
 * Finds the slide images that `render-slides` wrote.
 *
 * @param context - The stage context.
 * @returns The path of each slide image, in deck order.
 * @throws {ReadSlidesError} If the directory holds no slide image.
 */
async function readSlideImages(context: StageContext): Promise<SlideImages> {
	return {
		slideImagePaths: await findSlideImages({
			context,
			fail: (message) => new ReadSlidesError(message),
		}),
	};
}

/**
 * Reads each slide image with the model, with as many calls in flight as the
 * stage's `concurrency` allows. Each reading is written as soon as its reply is
 * usable.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The slide images.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The readings, the cost of the calls and the files written.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. CLAUDE.md permits a mutable type that a library requires.
async function readSlides({
	input,
	context,
	calls,
}: ModelStageRunArgs<SlideImages>): Promise<StageResult<ReadSlidesOutput>> {
	const slides = [...input.slideImagePaths.entries()].map(([index, imagePath]) => {
		const slideNumber = index + 1;
		return {
			slideNumber,
			imagePath,
			path: slideReadingPath({ workspaceRoot: context.workspaceRoot, slideNumber }),
		};
	});
	const { contents, cost } = await readOrMakeSavedFiles<(typeof slides)[number], SlideReading>({
		files: slides,
		label: "Slides",
		concurrency: configuredStage({ config: context.config, stageId: STAGE_ID })?.concurrency,
		readSaved: (value) => (isSlideReading(value) ? value : null),
		unreadable: (path) =>
			new ReadSlidesError(
				`${path} holds no readable slide reading. A reading is written whole, so something else changed it; delete it to read the slide again.`,
			),
		make: async ({ slideNumber, imagePath }) => {
			const sent = await calls.sendJsonWithResends({
				what: `Slide ${slideNumber}`,
				messages: buildSlideReadingMessages({
					pngBase64: (await readFile(imagePath)).toString("base64"),
					language: context.config.finalOutput.language,
				}),
				isReply: isSlideReadingReply,
				documentedShape: DOCUMENTED_REPLY_SHAPE,
				use: (reply) => usableReading({ reply, slideNumber }),
			});
			return { content: sent.reply, cost: sent.cost };
		},
	});
	return {
		output: { readings: contents },
		cost,
		filesWritten: slides.map((slide) => relative(context.workspaceRoot, slide.path)),
	};
}

/** Builds the `read-slides` stage from the logger and the OpenAI client of the invocation. */
export const createReadSlidesStage: ModelStageFactory<SlideImages, ReadSlidesOutput> =
	defineModelStage({ stageId: STAGE_ID, getInput: readSlideImages, run: readSlides });
