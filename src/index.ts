import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { confirm, select } from "@inquirer/prompts";
import cliProgress from "cli-progress";
import ffmpeg from "fluent-ffmpeg";
import { createUploadProgressStream } from "./utils/progress.js";

const BASE_DIR = "/Users/jamestarin/Source material/Lecture Content/Biology of Disease";
const SOURCE_DIR = path.join(BASE_DIR, "Lecture recordings");
const AUDIO_DIR = path.join(BASE_DIR, "Lecture audio extracts");
const OUTPUT_DIR = path.join(BASE_DIR, "Lecture transcriptions");

function extractAudio(args: { inputPath: string; outputPath: string }): Promise<void> {
	const { inputPath, outputPath } = args;
	// eslint-disable-next-line max-params -- Promise executor signature is spec-defined
	return new Promise((resolve, reject) => {
		const bar = new cliProgress.SingleBar(
			{ format: "Extracting audio |{bar}| {percentage}%", hideCursor: true },
			cliProgress.Presets.shades_classic,
		);
		bar.start(100, 0);

		ffmpeg(inputPath)
			.noVideo()
			.audioCodec("copy")
			.output(outputPath)
			.on("progress", (progress) => bar.update(Math.min(Math.round(progress.percent ?? 0), 99)))
			.on("end", () => {
				bar.update(100);
				bar.stop();
				resolve();
			})
			.on("error", (err) => {
				bar.stop();
				reject(err);
			})
			.run();
	});
}

async function main() {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		console.error("Error: ELEVENLABS_API_KEY not set in .env");
		process.exit(1);
	}

	fs.mkdirSync(AUDIO_DIR, { recursive: true });
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const files = fs
		.readdirSync(SOURCE_DIR)
		.filter((file) => file.toLowerCase().endsWith(".mp4"))
		.sort();

	if (files.length === 0) {
		console.log("No .mp4 files found in source directory.");
		process.exit(0);
	}

	const chosen = await select({
		message: "Select a lecture to transcribe:",
		choices: files.map((file) => ({ value: file, name: file })),
	});

	const inputPath = path.join(SOURCE_DIR, chosen);
	const stem = path.basename(chosen, path.extname(chosen));
	const audioPath = path.join(AUDIO_DIR, `${stem}.m4a`);
	const outputPath = path.join(OUTPUT_DIR, `${stem}.txt`);

	if (fs.existsSync(outputPath)) {
		const overwrite = await confirm({
			message: `A transcript already exists for "${chosen}". Overwrite it?`,
			default: false,
		});
		if (!overwrite) {
			console.log("Skipping — no changes made.");
			process.exit(0);
		}
	}

	console.log("");

	if (fs.existsSync(audioPath)) {
		console.log(`Audio extract already exists, skipping extraction:\n  ${audioPath}`);
	} else {
		await extractAudio({ inputPath, outputPath: audioPath });
		console.log(`Audio saved to:\n  ${audioPath}`);
	}

	console.log("");

	const totalBytes = fs.statSync(audioPath).size;
	const { stream: progressStream, bar } = createUploadProgressStream(totalBytes);

	const client = new ElevenLabsClient({ apiKey });

	const result = await client.speechToText
		.convert({
			file: fs.createReadStream(audioPath).pipe(progressStream),
			modelId: "scribe_v2",
			languageCode: "eng",
			noVerbatim: true,
		})
		.finally(() => bar.stop());

	if (!("text" in result)) {
		throw new Error("Unexpected response from ElevenLabs — no transcript text returned.");
	}

	console.log("\nTranscribing… (this may take a moment)");
	fs.writeFileSync(outputPath, result.text, "utf-8");
	console.log(`Transcript saved to:\n  ${outputPath}\n`);
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error("Error:", message);
	process.exit(1);
});
