import sharp from 'sharp';

import type { EmailAttachment } from '../domain/email-sender';
import type { EmailIcon, EmailTone } from '../templates/template.types';

export const EMAIL_LOGO_CID = 'eventini-logo@eventini';
export const EMAIL_ICON_CID = 'eventini-context-icon@eventini';

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="376" height="88" viewBox="0 0 376 88">
  <g fill="#222F90">
    <path fill-rule="evenodd" d="M28.4 5h38.2c9 0 14.8 6.8 14.8 15.2v47.6c0 8.4-5.8 15.2-14.8 15.2H28.4c-6.2 0-11.6-3.6-14-9.4L5 50.8a17.4 17.4 0 0 1 0-13.6l9.4-22.8A15 15 0 0 1 28.4 5Zm8.4 18a6 6 0 0 0-6 6v5.4h-4.2a4.4 4.4 0 1 0 0 8.8h4.2v2h-4.2a4.4 4.4 0 1 0 0 8.8h4.2v5.2a6 6 0 0 0 6 6h25.8a4.8 4.8 0 0 0 0-9.6H40.4V54h16.4a4.4 4.4 0 1 0 0-8.8H40.4v-2h16.4a4.4 4.4 0 1 0 0-8.8H40.4v-1.8h22.2a4.8 4.8 0 0 0 0-9.6H36.8Z"/>
    <text x="99" y="62" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700" letter-spacing="-2">Eventini</text>
  </g>
</svg>`;

const ICON_PATHS: Record<EmailIcon, string> = {
  'user-check':
    '<circle cx="21" cy="16" r="7"/><path d="M7 41c1-9 6-13 14-13s13 4 14 13"/><path d="m34 29 4 4 8-9"/>',
  'mail-check':
    '<rect x="5" y="10" width="38" height="28" rx="3"/><path d="m7 13 17 14 17-14"/><path d="m32 36 4 4 8-9"/>',
  key: '<circle cx="31" cy="17" r="10"/><path d="m24 24-17 17v6h7l4-4h6v-6h6l5-5"/><circle cx="34" cy="14" r="2"/>',
  'shield-check':
    '<path d="M24 4 42 11v13c0 12-8 20-18 24C14 44 6 36 6 24V11l18-7Z"/><path d="m15 25 6 6 12-14"/>',
  'shield-alert':
    '<path d="M24 4 42 11v13c0 12-8 20-18 24C14 44 6 36 6 24V11l18-7Z"/><path d="M24 15v12"/><circle cx="24" cy="34" r="1.5" fill="currentColor" stroke="none"/>',
  'monitor-x':
    '<rect x="4" y="7" width="34" height="25" rx="3"/><path d="M14 42h14M21 32v10"/><circle cx="39" cy="34" r="9" fill="currentColor" stroke="none"/><path d="m35 30 8 8m0-8-8 8" stroke="#fff"/>',
};

const iconColor: Record<EmailTone, string> = {
  info: '#315BE8',
  success: '#16A34A',
  danger: '#DC2626',
  neutral: '#64748B',
};

const logoPromise = sharp(Buffer.from(logoSvg)).png().toBuffer();
const iconCache = new Map<string, Promise<Buffer>>();

function iconPng(icon: EmailIcon, tone: EmailTone): Promise<Buffer> {
  const key = `${icon}:${tone}`;
  const cached = iconCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const color = iconColor[tone];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 48 52" color="${color}">
    <g fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[icon]}</g>
  </svg>`;
  const rendered = sharp(Buffer.from(svg)).png().toBuffer();
  iconCache.set(key, rendered);
  return rendered;
}

export async function renderEmailAssets(
  icon: EmailIcon,
  tone: EmailTone,
): Promise<readonly EmailAttachment[]> {
  return [
    {
      filename: 'eventini-logo.png',
      content: await logoPromise,
      contentType: 'image/png',
      cid: EMAIL_LOGO_CID,
    },
    {
      filename: `${icon}.png`,
      content: await iconPng(icon, tone),
      contentType: 'image/png',
      cid: EMAIL_ICON_CID,
    },
  ];
}

export const bufferDataUri = (attachment: EmailAttachment): string =>
  `data:${attachment.contentType};base64,${attachment.content.toString('base64')}`;
