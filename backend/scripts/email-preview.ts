import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EmailRenderer } from '../src/infrastructure/email/email-renderer';
import { EMAIL_PREVIEW_MESSAGES } from '../src/infrastructure/email/testing/email.fixtures';

async function main(): Promise<void> {
  const renderer = new EmailRenderer();
  const outputDirectory = join(process.cwd(), 'email-previews');
  await mkdir(outputDirectory, { recursive: true });

  const links: string[] = [];
  for (const message of EMAIL_PREVIEW_MESSAGES) {
    const rendered = await renderer.render(message, { embedAssets: true });
    const htmlName = `${message.templateId}.html`;
    await writeFile(join(outputDirectory, htmlName), rendered.html, 'utf8');
    await writeFile(
      join(outputDirectory, `${message.templateId}.txt`),
      rendered.text,
      'utf8',
    );
    links.push(`<li><a href="./${htmlName}">${message.templateId}</a></li>`);
  }

  await writeFile(
    join(outputDirectory, 'index.html'),
    `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Eventini email previews</title><body style="font-family:Arial,sans-serif;padding:32px"><h1>Eventini — transactional emails</h1><ul>${links.join('')}</ul></body></html>`,
    'utf8',
  );

  process.stdout.write(
    `Generated ${links.length} previews in ${outputDirectory}\n`,
  );
}

void main();
