import { readFile } from 'node:fs/promises';
import { lint } from 'markdownlint/promise';
import { listRepositoryFiles } from './check-repository.mjs';

const files = listRepositoryFiles(process.cwd()).filter((file) => /\.md$/i.test(file));
const config = JSON.parse(
  await readFile(new URL('../.markdownlint.json', import.meta.url), 'utf8'),
);
const results = await lint({ files, config });
let errorCount = 0;

for (const [filename, errors] of Object.entries(results)) {
  for (const error of errors) {
    console.error(
      `${filename}:${error.lineNumber} ${error.ruleNames[0]} ${error.ruleDescription}${error.errorDetail ? `: ${error.errorDetail}` : ''}`,
    );
    errorCount += 1;
  }
}

if (errorCount) {
  process.exitCode = 1;
} else {
  console.log(`Markdown lint passed (${files.length} files).`);
}
