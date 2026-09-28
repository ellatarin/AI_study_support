#!/usr/bin/env node
/*
 * Prints pre-commit-check's report of a passed gate: the test run's output
 * comes in on stdin, the hook's JSON goes out on stdout (see gate-summary.mjs).
 */

import { gateHookOutput, summariseGate } from "./gate-summary.mjs";
import { readStdin } from "./hook-payload.mjs";

const testOutput = await readStdin();
process.stdout.write(gateHookOutput({ summary: summariseGate({ testOutput }) }));
