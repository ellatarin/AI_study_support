import { describe, expect, it } from "vitest";
import { testLecture } from "../../fixtures.js";
import { buildFactCheckMessages } from "./check-facts.prompt.js";

describe("buildFactCheckMessages", () => {
	it("should send the rewritten subtopics in lecture order, each under its id and title, when the stage builds the user message", () => {
		const messages = buildFactCheckMessages({
			lectureTitle: testLecture.title,
			subtopics: [
				{
					subtopicId: 1,
					title: "Opening",
					rewrittenSubtopic: ["First paragraph.", "Second paragraph."],
				},
				{ subtopicId: 2, title: "Tobacco", rewrittenSubtopic: ["Smoking causes [FIGURE] cancer."] },
			],
		});

		expect(messages[1]).toStrictEqual({
			role: "user",
			content:
				"## Subtopic 1: Opening\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Subtopic 2: Tobacco\n\nSmoking causes [FIGURE] cancer.",
		});
	});

	it("should name the lecture in the prompt when the stage builds the system message", () => {
		const [system] = buildFactCheckMessages({ lectureTitle: testLecture.title, subtopics: [] });

		expect(system?.content).toContain(`The notes are for one lecture, "${testLecture.title}".`);
	});
});
