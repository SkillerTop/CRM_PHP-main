import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { recognizeFile } from "./ocr.js";

async function main(): Promise<void> {
  const folder = process.argv[2] ?? "/cards";
  const files = (await readdir(folder)).filter((name) =>
    /\.(?:jpe?g|png|webp|bmp|tiff?)$/i.test(name),
  );
  if (!files.length) {
    console.log(`No image files found in ${folder}.`);
    return;
  }
  let failed = 0;
  for (const name of files) {
    try {
      console.log(
        JSON.stringify({
          file: name,
          result: await recognizeFile(join(folder, name)),
        }),
      );
    } catch (error) {
      failed++;
      console.error(
        `${name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
