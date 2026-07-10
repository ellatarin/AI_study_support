import 'dotenv/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { select, confirm } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';

const SOURCE_DIR =
  '/Users/jamestarin/Source material/Lecture Content/Biology of Disease/Lecture recordings';
const OUTPUT_DIR =
  '/Users/jamestarin/Source material/Lecture Content/Biology of Disease/Lecture transcriptions';

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Error: ELEVENLABS_API_KEY not set in .env');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .sort();

  if (files.length === 0) {
    console.log('No .mp4 files found in source directory.');
    process.exit(0);
  }

  const chosen = await select({
    message: 'Select a lecture to transcribe:',
    choices: files.map((f) => ({ value: f, name: f })),
  });

  const inputPath = path.join(SOURCE_DIR, chosen);
  const outputFilename = path.basename(chosen, path.extname(chosen)) + '.txt';
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  if (fs.existsSync(outputPath)) {
    const overwrite = await confirm({
      message: `A transcript already exists for "${chosen}". Overwrite it?`,
      default: false,
    });
    if (!overwrite) {
      console.log('Skipping — no changes made.');
      process.exit(0);
    }
  }

  console.log(`\nUploading "${chosen}" to ElevenLabs…`);

  const client = new ElevenLabsClient({ apiKey });

  const result = await client.speechToText.convert({
    file: fs.createReadStream(inputPath),
    modelId: 'scribe_v1',
  });

  if (!('text' in result)) {
    throw new Error('Unexpected response from ElevenLabs — no transcript text returned.');
  }

  fs.writeFileSync(outputPath, result.text, 'utf-8');
  console.log(`\nTranscript saved to:\n  ${outputPath}\n`);
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
