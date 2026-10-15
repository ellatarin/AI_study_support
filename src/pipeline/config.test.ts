import { describe, expect, it } from "vitest";
import { NO_CONFIG_OVERRIDES, type PipelineConfig } from "../types/pipeline.js";
import { applyConfigOverrides, ConfigError, readFactCheckModels } from "./config.js";
import {
	disabledFactCheckModel,
	makeConfig,
	openRouterStageConfig,
	primaryFactCheckModel,
	secondaryFactCheckModel,
} from "./fixtures.js";

const LABEL = "stages.check-facts.models";

/** The raw entries of a `models` list, each with its own settings. */
const primaryEntry = { ...primaryFactCheckModel, temperature: 0.2 };
const secondaryEntry = { ...secondaryFactCheckModel, maxTokens: null };

describe("readFactCheckModels", () => {
	it("should give each model with its role and settings when the list has one primary, one secondary and one disabled model", () => {
		const models = readFactCheckModels({
			value: [primaryEntry, secondaryEntry, disabledFactCheckModel],
			label: LABEL,
		});

		expect(models).toStrictEqual([
			{ ...primaryFactCheckModel, temperature: 0.2, maxTokens: undefined },
			{ ...secondaryFactCheckModel, temperature: undefined, maxTokens: undefined },
			{ ...disabledFactCheckModel, temperature: undefined, maxTokens: undefined },
		]);
	});

	it.each([
		{
			condition: "the list has no primary model",
			value: [secondaryEntry],
			rule: `${LABEL} must have exactly one model with role "primary" (it has 0)`,
		},
		{
			condition: "the list has two primary models",
			value: [primaryEntry, { ...secondaryEntry, role: "primary" }],
			rule: `${LABEL} must have exactly one model with role "primary" (it has 2)`,
		},
		{
			condition: "the list has two secondary models",
			value: [primaryEntry, secondaryEntry, { ...disabledFactCheckModel, role: "secondary" }],
			rule: `${LABEL} must have no more than one model with role "secondary" (it has 2)`,
		},
		{
			condition: "an entry has a role that is not one of the three",
			value: [primaryEntry, { ...secondaryEntry, role: "backup" }],
			rule: `${LABEL}[1].role must be one of "primary", "secondary", "disabled"`,
		},
		{
			condition: "two entries have the same model id without the provider",
			value: [primaryEntry, { ...secondaryEntry, modelId: "azure/gpt-5.6-sol-pro" }],
			rule: `${LABEL}[1].modelId must not give the same fact-check file as ${LABEL}[0].modelId ("gpt-5.6-sol-pro.json")`,
		},
		{
			condition: "the value is not a list",
			value: primaryEntry,
			rule: `${LABEL} must be an array of model entries`,
		},
	])("should refuse the list with an error that names the rule when $condition", ({
		value,
		rule,
	}) => {
		expect(() => readFactCheckModels({ value, label: LABEL })).toThrow(new ConfigError(rule));
	});
});

describe("applyConfigOverrides", () => {
	const stageId = "correct-factual-errors";

	function configWithBypass(bypass: boolean): PipelineConfig {
		return makeConfig({ stages: { [stageId]: { ...openRouterStageConfig({ stageId }), bypass } } });
	}

	function configWithFinalOutput(fields: Partial<PipelineConfig["finalOutput"]>): PipelineConfig {
		const config = makeConfig();
		return { ...config, finalOutput: { ...config.finalOutput, ...fields } };
	}

	it.each([
		{ configured: true, factCorrection: "run", bypass: false },
		{ configured: false, factCorrection: "bypass", bypass: true },
	] as const)("should set bypass to $bypass when the config has $configured and the fact correction override is $factCorrection", ({
		configured,
		factCorrection,
		bypass,
	}) => {
		const config = applyConfigOverrides({
			config: configWithBypass(configured),
			overrides: { ...NO_CONFIG_OVERRIDES, factCorrection },
		});

		expect(config).toStrictEqual(configWithBypass(bypass));
	});

	it.each([
		{
			change: "the page views to notes and transcript",
			override: { pageViews: ["notes", "transcript"] },
			configured: { pageViews: ["notes", "rewrite", "corrections", "transcript"] },
			applied: { pageViews: ["notes", "transcript"] },
		},
		{
			change: "the highlight off",
			override: { highlightSlideSentences: "off" },
			configured: { highlightSlideSentences: true },
			applied: { highlightSlideSentences: false },
		},
		{
			change: "the highlight on",
			override: { highlightSlideSentences: "on" },
			configured: { highlightSlideSentences: false },
			applied: { highlightSlideSentences: true },
		},
	] as const)("should set $change in finalOutput when the override differs from the config", ({
		override,
		configured,
		applied,
	}) => {
		const config = applyConfigOverrides({
			config: configWithFinalOutput(configured),
			overrides: { ...NO_CONFIG_OVERRIDES, ...override },
		});

		expect(config).toStrictEqual(configWithFinalOutput(applied));
	});

	it("should add no stage entry when the config has no fact correction entry and the override is run", () => {
		const config = applyConfigOverrides({
			config: makeConfig(),
			overrides: { ...NO_CONFIG_OVERRIDES, factCorrection: "run" },
		});

		expect(config.stages).toStrictEqual({});
	});

	it("should keep each config value when there are no overrides", () => {
		const configured = {
			...configWithBypass(true),
			finalOutput: {
				...makeConfig().finalOutput,
				pageViews: ["notes"],
				highlightSlideSentences: false,
			},
		} as const;

		const config = applyConfigOverrides({ config: configured, overrides: NO_CONFIG_OVERRIDES });

		expect(config).toStrictEqual(configured);
	});
});
