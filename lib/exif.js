import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import webp from 'node-webpmux';
import path from 'path';

const tempDir = os.tmpdir();

function tempFile(ext) {
  return path.join(
    tempDir,
    `${crypto.randomBytes(8).toString('hex')}.${ext}`
  );
}

async function imageToWebp(media) {
  const input = tempFile('jpg');
  const output = tempFile('webp');

  try {
    fs.writeFileSync(input, media);

    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .on('error', reject)
        .on('end', resolve)
        .addOutputOptions([
          '-vcodec',
          'libwebp',
          '-vf',
          "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse"
        ])
        .toFormat('webp')
        .save(output);
    });

    return fs.readFileSync(output);
  } finally {
    if (fs.existsSync(input)) {
      fs.unlinkSync(input);
    }

    if (fs.existsSync(output)) {
      fs.unlinkSync(output);
    }
  }
}

async function videoToWebp(media) {
  const input = tempFile('mp4');
  const output = tempFile('webp');

  try {
    fs.writeFileSync(input, media);

    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .on('error', reject)
        .on('end', resolve)
        .addOutputOptions([
          '-vcodec',
          'libwebp',
          '-vf',
          "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
          '-loop',
          '0',
          '-ss',
          '00:00:00',
          '-t',
          '00:00:05',
          '-preset',
          'default',
          '-an',
          '-vsync',
          '0'
        ])
        .toFormat('webp')
        .save(output);
    });

    return fs.readFileSync(output);
  } finally {
    if (fs.existsSync(input)) {
      fs.unlinkSync(input);
    }

    if (fs.existsSync(output)) {
      fs.unlinkSync(output);
    }
  }
}

async function addExif(media, metadata = {}) {
  const img = new webp.Image();

  const json = {
    'sticker-pack-id':
      'https://github.com/Furina-Bot/Furina',

    'sticker-pack-name':
      metadata.packname || 'Furina',

    'sticker-pack-publisher':
      metadata.author || 'Furina',

    emojis:
      Array.isArray(metadata.categories)
        ? metadata.categories
        : ['']
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x41, 0x57, 0x07, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x16, 0x00, 0x00, 0x00
  ]);

  const jsonBuffer = Buffer.from(
    JSON.stringify(json),
    'utf8'
  );

  const exifBuffer = Buffer.concat([
    exifAttr,
    jsonBuffer
  ]);

  exifBuffer.writeUIntLE(
    jsonBuffer.length,
    14,
    4
  );

  const input = tempFile('webp');
  const output = tempFile('webp');

  try {
    fs.writeFileSync(input, media);

    await img.load(input);

    img.exif = exifBuffer;

    await img.save(output);

    return output;
  } finally {
    if (fs.existsSync(input)) {
      fs.unlinkSync(input);
    }
  }
}

async function writeExifImg(
  media,
  metadata = {}
) {
  const webpBuffer =
    await imageToWebp(media);

  if (
    !metadata.packname &&
    !metadata.author
  ) {
    return webpBuffer;
  }

  return addExif(
    webpBuffer,
    metadata
  );
}

async function writeExifVid(
  media,
  metadata = {}
) {
  const webpBuffer =
    await videoToWebp(media);

  if (
    !metadata.packname &&
    !metadata.author
  ) {
    return webpBuffer;
  }

  return addExif(
    webpBuffer,
    metadata
  );
}

async function writeExif(
  media,
  metadata = {}
) {
  let webpBuffer;

  if (
    media?.mimetype &&
    /webp/i.test(
      media.mimetype
    )
  ) {
    webpBuffer = media.data;
  } else if (
    media?.mimetype &&
    /image/i.test(
      media.mimetype
    )
  ) {
    webpBuffer =
      await imageToWebp(
        media.data
      );
  } else if (
    media?.mimetype &&
    /video/i.test(
      media.mimetype
    )
  ) {
    webpBuffer =
      await videoToWebp(
        media.data
      );
  } else {
    throw new Error(
      'نوع الوسائط غير مدعوم'
    );
  }

  if (
    !metadata.packname &&
    !metadata.author
  ) {
    return webpBuffer;
  }

  return addExif(
    webpBuffer,
    metadata
  );
}

export {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  writeExif
};

export default {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  writeExif
};
