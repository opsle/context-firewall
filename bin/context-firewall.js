#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { conformanceReport } from '../fixtures/corpus.js';
import {
  InputError,
  PayloadCeilingError,
  canonicalJson,
  reduceTestRun,
  serializePacket,
} from '../src/reducer.js';

function usage() {
  return 'usage: context-firewall reduce [--input PATH|-] [--max-bytes N]\n       context-firewall conformance\n';
}

function parseReduceArgs(args) {
  let input = '-';
  let maxOutputBytes = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--input' && args[index + 1]) input = args[++index];
    else if (args[index] === '--max-bytes' && args[index + 1]) {
      maxOutputBytes = Number(args[++index]);
    } else throw new InputError(`unknown or incomplete argument: ${args[index]}`);
  }
  return { input, maxOutputBytes };
}

async function readInput(path) {
  if (path !== '-') return readFile(path);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'conformance') {
    if (args.length > 0) throw new InputError('conformance accepts no arguments');
    const report = conformanceReport();
    process.stdout.write(`${canonicalJson(report)}\n`);
    process.exitCode = report.conformance === 'PASS' ? 0 : 1;
    return;
  }
  if (command !== 'reduce') {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  const options = parseReduceArgs(args);
  const bytes = await readInput(options.input);
  let input;
  try {
    input = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InputError('input must be valid JSON');
  }
  const packet = reduceTestRun(input, { maxOutputBytes: options.maxOutputBytes });
  process.stdout.write(serializePacket(packet));
}

main().catch((error) => {
  const body = error instanceof PayloadCeilingError
    ? { code: error.code, ...error.details }
    : { code: error.code ?? 'INTERNAL_ERROR', message: error.message };
  process.stderr.write(`${canonicalJson(body)}\n`);
  process.exitCode = error instanceof InputError || error instanceof PayloadCeilingError ? 2 : 1;
});
