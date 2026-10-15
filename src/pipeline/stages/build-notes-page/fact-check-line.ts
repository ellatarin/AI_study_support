/**
 * The fact-check line of the notes page and the Notes PDF (CONTEXT.md,
 * "Fact-check line").
 */

import { splitModelId } from "../../../utils/model-id.js";
import type { FactCorrectedSubtopics } from "../fact-corrections.js";
import type { FactualErrorsFile } from "../factual-errors.js";

/** The fact-check line of notes whose fact check or fact correction was bypassed. */
const UNCORRECTED = "Uncorrected";

/**
 * Gives the name of a model in the fact-check line: the part of its id after the provider.
 *
 * @param modelId - The model id.
 * @returns The name of the model.
 */
function modelName(modelId: string): string {
	return splitModelId(modelId).name;
}

/**
 * Gives the fact-check line of a lecture, from the files of the fact check and the fact correction.
 *
 * @param args - The two files.
 * @param args.factualErrors - The content of `factual-errors.json`.
 * @param args.factCorrections - The content of `fact-corrected-subtopics.json`.
 * @returns The line, such as "Checked by: a (prompt f2). Corrected by: b (prompt k3) on 15-10-2026".
 */
export function factCheckLine({
	factualErrors,
	factCorrections,
}: {
	readonly factualErrors: FactualErrorsFile;
	readonly factCorrections: FactCorrectedSubtopics;
}): string {
	const { correctedBy, correctedOn } = factCorrections;
	if (factualErrors.bypassed || correctedBy === null || correctedOn === null) {
		return UNCORRECTED;
	}
	const checkers = factualErrors.checkedBy.map(modelName).join(", ");
	// A saved subtopic file can come from an earlier prompt, so the line names each version once.
	const correctionPrompts = [
		...new Set(
			factCorrections.factCorrectedSubtopics.map(
				({ factCorrectionPromptVersion }) => factCorrectionPromptVersion,
			),
		),
	].join(", ");
	// The ISO date `YYYY-MM-DD` reads as `DD-MM-YYYY` in the line.
	const correctionDate = correctedOn.split("-").reverse().join("-");
	return `Checked by: ${checkers} (prompt ${factualErrors.factCheckPromptVersion}). Corrected by: ${modelName(correctedBy)} (prompt ${correctionPrompts}) on ${correctionDate}`;
}
