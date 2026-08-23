import { checkbox, confirm, select } from "@inquirer/prompts";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { otherModuleRoot, testLecture, testModuleRoot } from "../pipeline/fixtures.js";
import { workspaceRootFor } from "../pipeline/layout.js";
import type { LectureMatch } from "../types/pipeline.js";
import { confirmPrompt, selectLectureMatch, selectLectureMatches } from "./prompts.js";

vi.mock("@inquirer/prompts", () => ({ checkbox: vi.fn(), confirm: vi.fn(), select: vi.fn() }));

/** One choice as the checkbox was offered it. */
type Choice = { readonly name: string; readonly value: number };

// The real prompts return a cancelable promise and a wide choice union; the
// module under test uses neither, so the doubles are typed to what it does use.
const askConfirm = confirm as unknown as Mock<
	(args: { readonly message: string; readonly default?: boolean }) => Promise<boolean>
>;
const askCheckbox = checkbox as unknown as Mock<
	(args: {
		readonly message: string;
		readonly choices: readonly Choice[];
	}) => Promise<readonly number[]>
>;
const askSelect = select as unknown as Mock<
	(args: { readonly message: string; readonly choices: readonly Choice[] }) => Promise<number>
>;

/** A match in the given module, with a workspace laid out as the pipeline would. */
function matchIn({
	moduleRoot,
	lectureNumber,
	lectureTitle,
}: {
	readonly moduleRoot: string;
	readonly lectureNumber: number;
	readonly lectureTitle: string;
}): LectureMatch {
	return {
		moduleRoot,
		workspaceRoot: workspaceRootFor({
			moduleRoot,
			folderName: `Lecture ${String(lectureNumber)} - ${lectureTitle}`,
		}),
		lectureNumber,
		lectureTitle,
	};
}

const matches: readonly LectureMatch[] = [
	matchIn({
		moduleRoot: testModuleRoot,
		lectureNumber: testLecture.number,
		lectureTitle: testLecture.title,
	}),
	matchIn({ moduleRoot: otherModuleRoot, lectureNumber: 3, lectureTitle: "Antigens" }),
];

/** Either prompt double, seen only as the calls it recorded. */
type PromptDouble = { readonly mock: { readonly calls: readonly unknown[] } };

/** The choices a prompt was offered, in the order they were presented. */
function offeredChoices(prompt: PromptDouble = askCheckbox): readonly Choice[] {
	const [call] = prompt.mock.calls;
	return (call as [{ readonly choices: readonly Choice[] }])[0].choices;
}

/** The value of the choice whose label contains the given text. */
function choiceValueFor(label: string, prompt: PromptDouble = askCheckbox): number {
	return (offeredChoices(prompt).find((candidate) => candidate.name.includes(label)) as Choice)
		.value;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("confirmPrompt", () => {
	it.each([
		{ scenario: "the user approves", answer: true },
		{ scenario: "the user declines", answer: false },
	])("should return $answer when $scenario", async ({ answer }) => {
		askConfirm.mockResolvedValue(answer);

		expect(await confirmPrompt({ message: "Delete the workspace?" })).toBe(answer);
	});

	it("should default to declining when the question is asked", async () => {
		askConfirm.mockResolvedValue(false);

		await confirmPrompt({ message: "Delete the workspace?" });

		expect(askConfirm).toHaveBeenCalledWith({ message: "Delete the workspace?", default: false });
	});
});

describe("selectLectureMatches", () => {
	beforeEach(() => {
		askCheckbox.mockResolvedValue([]);
	});

	it("should label every match with its module, number, and title when prompting", async () => {
		await selectLectureMatches({ matches });

		const labels = offeredChoices().map((choice) => choice.name);
		expect(labels).toContain("Biology of Disease — Lecture 1 — Cell Injury");
		expect(labels).toContain("Immunology — Lecture 3 — Antigens");
	});

	it("should offer an all-matches and a cancel choice when prompting", async () => {
		await selectLectureMatches({ matches });

		const labels = offeredChoices().map((choice) => choice.name);
		expect(labels).toContain("All matches");
		expect(labels).toContain("Cancel");
	});

	it("should return every match when the user chooses all matches", async () => {
		askCheckbox.mockImplementation(async () => [choiceValueFor("All matches")]);

		expect(await selectLectureMatches({ matches })).toEqual(matches);
	});

	it("should return nothing when the user cancels", async () => {
		askCheckbox.mockImplementation(async () => [choiceValueFor("Cancel"), choiceValueFor("Cell")]);

		expect(await selectLectureMatches({ matches })).toEqual([]);
	});

	it("should return only the chosen lectures when the user picks some of them", async () => {
		askCheckbox.mockImplementation(async () => [choiceValueFor("Antigens")]);

		expect(await selectLectureMatches({ matches })).toEqual([matches[1]]);
	});

	it("should return nothing when the user chooses no lecture at all", async () => {
		askCheckbox.mockResolvedValue([]);

		expect(await selectLectureMatches({ matches })).toEqual([]);
	});
});

describe("selectLectureMatch", () => {
	beforeEach(() => {
		askSelect.mockResolvedValue(0);
	});

	it("should label every match with its module, number, and title when prompting", async () => {
		await selectLectureMatch({ matches });

		const labels = offeredChoices(askSelect).map((choice) => choice.name);
		expect(labels).toEqual([
			"Biology of Disease — Lecture 1 — Cell Injury",
			"Immunology — Lecture 3 — Antigens",
			"Cancel",
		]);
	});

	it("should offer no all-matches choice when prompting", async () => {
		await selectLectureMatch({ matches });

		// One new title cannot belong to two lectures, so this picker takes exactly one.
		expect(offeredChoices(askSelect).map((choice) => choice.name)).not.toContain("All matches");
	});

	it("should return the single lecture chosen when the user picks one", async () => {
		askSelect.mockImplementation(async () => choiceValueFor("Antigens", askSelect));

		expect(await selectLectureMatch({ matches })).toEqual(matches[1]);
	});

	it("should return nothing when the user cancels", async () => {
		askSelect.mockImplementation(async () => choiceValueFor("Cancel", askSelect));

		expect(await selectLectureMatch({ matches })).toBeNull();
	});
});
