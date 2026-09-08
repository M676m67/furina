import {
  proto,
  delay,
  areJidsSameUser,
  generateWAMessage,
  generateWAMessageFromContent,
  downloadContentFromMessage,
  getContentType,
  getDevice,
  extractMessageContent,
  jidDecode
} from 'baileys';

import db from '#db';
import fs from 'fs';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import GraphemeSplitter from 'grapheme-splitter';
import exif from './exif.js';

const splitter = new GraphemeSplitter();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid
} = exif;


class BoundedMap {
  #map = new Map();
  #max;
  #ttl;

  constructor(max, ttlMs = 0) {
    this.#max = max;
    this.#ttl = ttlMs;
  }

  #expired(entry) {
    return (
      this.#ttl > 0 &&
      Date.now() - entry.ts > this.#ttl
    );
  }

  has(key) {
    const entry = this.#map.get(key);

    if (!entry) return false;

    if (this.#expired(entry)) {
      this.#map.delete(key);
      return false;
    }

    return true;
  }

  get(key) {
    const entry = this.#map.get(key);

    if (!entry) return undefined;

    if (this.#expired(entry)) {
      this.#map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value) {
    if (this.#map.size >= this.#max) {
      const first = this.#map.keys().next().value;

      if (first !== undefined) {
        this.#map.delete(first);
      }
    }

    this.#map.set(key, {
      value,
      ts: Date.now()
    });
  }

  delete(key) {
    this.#map.delete(key);
  }
}

const groupMetaCache = new Map();

const lidCache = new BoundedMap(
  2000,
  24 * 60 * 60 * 1000
);

const META_TTL = 5 * 60 * 1000;

const gcMeta = setInterval(() => {
  const now = Date.now();

  for (const [key, value] of groupMetaCache) {
    if (now - value.ts > META_TTL) {
      groupMetaCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

gcMeta.unref?.();



function getCachedMeta(groupJid) {
  const cached = groupMetaCache.get(groupJid);

  if (
    !cached ||
    Date.now() - cached.ts > META_TTL
  ) {
    return null;
  }

  return cached.metadata;
}

function setCachedMeta(groupJid, metadata) {
  groupMetaCache.set(groupJid, {
    metadata,
    ts: Date.now()
  });
}

function deleteCachedMeta(groupJid) {
  groupMetaCache.delete(groupJid);
}

function normalizeJid(raw) {
  if (!raw) return null;

  const value =
    typeof raw === 'number'
      ? String(raw)
      : String(raw).trim();

  if (!value) return null;

  if (
    value.endsWith('@g.us') ||
    value.endsWith('@newsletter') ||
    value.endsWith('@lid') ||
    value.endsWith('@s.whatsapp.net')
  ) {
    return value;
  }

  if (/:\\d+@/i.test(value)) {
    const decoded = jidDecode(value);

    if (
      decoded?.user &&
      decoded?.server
    ) {
      return `${decoded.user}@${decoded.server}`;
    }
  }

  const digits = value.replace(/\D/g, '');

  if (
    digits &&
    digits.length >= 4 &&
    digits.length <= 15
  ) {
    return `${digits}@s.whatsapp.net`;
  }

  return value;
}

function resolveParticipantJid(
  participant,
  furina
) {
  if (!participant) return null;

  if (typeof participant === 'string') {
    return normalizeJid(participant);
  }

  const possible = [
    participant.phoneNumber,
    participant.id,
    participant.jid
  ];

  for (const value of possible) {
    if (!value) continue;

    const jid = normalizeJid(value);

    if (
      jid &&
      !jid.endsWith('@lid')
    ) {
      return jid;
    }
  }

  const rawLid =
    participant.lid ||
    (
      participant.id?.endsWith('@lid')
        ? participant.id
        : null
    ) ||
    (
      participant.jid?.endsWith('@lid')
        ? participant.jid
        : null
    );

  if (!rawLid) return null;

  if (lidCache.has(rawLid)) {
    return lidCache.get(rawLid);
  }

  if (
    typeof furina?.findJidByLid ===
    'function'
  ) {
    const found =
      furina.findJidByLid(rawLid);

    if (
      found &&
      !found.endsWith('@lid')
    ) {
      const jid = normalizeJid(found);

      if (jid) {
        lidCache.set(rawLid, jid);
        return jid;
      }
    }
  }

  return rawLid;
}

function resolveParticipants(
  participants,
  furina
) {
  if (!Array.isArray(participants)) {
    return [];
  }

  return participants
    .map(participant => {
      const jid =
        resolveParticipantJid(
          participant,
          furina
        );

      if (!jid) return participant;

      return {
        ...participant,
        id: jid
      };
    })
    .filter(Boolean);
}

function resolveJidSync(
  raw,
  furina
) {
  if (!raw) return null;

  const normalized =
    normalizeJid(raw);

  if (!normalized) return null;

  if (
    !normalized.endsWith('@lid')
  ) {
    return normalized;
  }

  if (lidCache.has(normalized)) {
    return lidCache.get(normalized);
  }

  if (
    typeof furina?.findJidByLid ===
    'function'
  ) {
    const found =
      furina.findJidByLid(normalized);

    if (
      found &&
      !found.endsWith('@lid')
    ) {
      const jid = normalizeJid(found);

      if (jid) {
        lidCache.set(
          normalized,
          jid
        );

        return jid;
      }
    }
  }

  return normalized;
}

async function resolveJidAsync(
  raw,
  furina,
  groupJid
) {
  if (!raw) return null;

  const normalized =
    normalizeJid(raw);

  if (!normalized) return null;

  if (
    !normalized.endsWith('@lid')
  ) {
    return normalized;
  }

  const sync =
    resolveJidSync(
      normalized,
      furina
    );

  if (
    sync &&
    !sync.endsWith('@lid')
  ) {
    return sync;
  }

  if (
    !groupJid ||
    !groupJid.endsWith('@g.us')
  ) {
    return normalized;
  }

  let metadata =
    getCachedMeta(groupJid);

  if (!metadata) {
    try {
      metadata =
        await furina.groupMetadata(
          groupJid
        );

      if (metadata?.participants) {
        setCachedMeta(
          groupJid,
          metadata
        );
      }
    } catch {
      return normalized;
    }
  }

  const lidBase =
    normalized.split('@')[0];

  for (
    const participant
    of metadata?.participants || []
  ) {
    const participantLid =
      participant.lid?.split('@')[0];

    const participantId =
      participant.id &&
      !participant.id.endsWith('@lid')
        ? participant.id.split('@')[0]
        : null;

    if (
      participantLid !== lidBase &&
      participantId !== lidBase
    ) {
      continue;
    }

    const phone =
      participant.phoneNumber
        ? normalizeJid(
            participant.phoneNumber
          )
        : participant.id &&
          !participant.id.endsWith('@lid')
          ? normalizeJid(
              participant.id
            )
          : null;

    if (phone) {
      lidCache.set(
        normalized,
        phone
      );

      return phone;
    }
  }

  return normalized;
}


function patchGroupMetadata(furina) {
  if (
    furina.groupMetadataPatched
  ) {
    return;
  }

  if (
    typeof furina.groupMetadata !==
    'function'
  ) {
    return;
  }

  furina.groupMetadataPatched = true;

  const original =
    furina.groupMetadata.bind(
      furina
    );

  furina.groupMetadata =
    async jid => {
      try {
        const metadata =
          await original(jid);

        if (
          !metadata?.participants
        ) {
          return metadata;
        }

        metadata.participants =
          resolveParticipants(
            metadata.participants,
            furina
          );

        setCachedMeta(
          jid,
          metadata
        );

        return metadata;
      } catch {
        return null;
      }
    };
}


export async function getBuffer(
  url,
  options = {}
) {
  const response =
    await axios({
      method: 'GET',
      url,
      headers: {
        DNT: '1',
        'Upgrade-Insecure-Request': '1'
      },
      responseType: 'arraybuffer',
      timeout: 30000,
      ...options
    });

  return response.data;
}


export async function smsg(
  furina,
  msg,
  store
) {
  if (!msg) return msg;

  patchGroupMetadata(furina);

  if (!furina.decodeJid) {
    furina.decodeJid =
      jid => {
        if (!jid) return jid;

        if (/:\\d+@/i.test(jid)) {
          const decoded =
            jidDecode(jid);

          return (
            decoded?.user &&
            decoded?.server
          )
            ? `${decoded.user}@${decoded.server}`
            : jid;
        }

        return jid;
      };
  }

  if (!furina.downloadMediaMessage) {
    furina.downloadMediaMessage =
      async message => {
        const content =
          message.msg || message;

        const mime =
          content.mimetype || '';

        const type =
          (
            message.type ||
            mime.split('/')[0]
          ).replace(
            /Message/gi,
            ''
          );

        const stream =
          await downloadContentFromMessage(
            content,
            type
          );

        const chunks = [];

        for await (
          const chunk of stream
        ) {
          chunks.push(chunk);
        }

        return Buffer.concat(chunks);
      };
  }

  if (msg.key) {
    msg.id = msg.key.id;
    msg.chat = msg.key.remoteJid;
    msg.fromMe = msg.key.fromMe;

    msg.isGroup =
      msg.chat?.endsWith(
        '@g.us'
      ) ?? false;

    if (
      !msg.isGroup &&
      msg.chat?.endsWith('@lid')
    ) {
      const resolved =
        await resolveJidAsync(
          msg.chat,
          furina,
          null
        );

      if (
        resolved &&
        !resolved.endsWith('@lid')
      ) {
        msg.chat = resolved;
      }
    }

    const rawSender =
      msg.fromMe
        ? furina.user?.id
        : msg.key.participant ||
          msg.key.remoteJid ||
          '';

    msg.sender =
      await resolveJidAsync(
        furina.decodeJid(
          rawSender
        ),
        furina,
        msg.key.remoteJid
      );
  }

  if (msg.message) {
    msg.type =
      getContentType(
        msg.message
      ) ||
      Object.keys(
        msg.message
      )[0];

    const messageContent =
      msg.message[
        msg.type
      ];

    msg.msg =
      extractMessageContent(
        messageContent
      ) ||
      messageContent;

    msg.body =
      msg.message?.conversation ||
      msg.msg?.text ||
      msg.msg?.conversation ||
      msg.msg?.caption ||
      msg.msg?.selectedButtonId ||
      msg.msg?.singleSelectReply
        ?.selectedRowId ||
      msg.msg?.selectedId ||
      msg.msg?.contentText ||
      msg.msg?.selectedDisplayText ||
      msg.msg?.title ||
      msg.msg?.name ||
      '';

    const rawMentioned =
      msg.msg?.contextInfo
        ?.mentionedJid || [];

    let metadataParticipants =
      null;

    if (
      msg.isGroup &&
      rawMentioned.some(
        jid =>
          jid?.endsWith('@lid')
      )
    ) {
      try {
        const metadata =
          getCachedMeta(
            msg.chat
          ) ||
          await furina
            .groupMetadata(
              msg.chat
            )
            .catch(() => null);

        if (metadata) {
          setCachedMeta(
            msg.chat,
            metadata
          );
        }

        metadataParticipants =
          metadata?.participants ||
          null;
      } catch {}
    }

    const resolveMention =
      raw => {
        const normalized =
          normalizeJid(raw);

        if (!normalized) {
          return null;
        }

        if (
          !normalized.endsWith(
            '@lid'
          )
        ) {
          return normalized;
        }

        const sync =
          resolveJidSync(
            normalized,
            furina
          );

        if (
          sync &&
          !sync.endsWith('@lid')
        ) {
          return sync;
        }

        if (metadataParticipants) {
          const lidBase =
            normalized.split('@')[0];

          for (
            const participant
            of metadataParticipants
          ) {
            if (
              participant.lid
                ?.split('@')[0] ===
              lidBase
            ) {
              return participant.id;
            }

            if (
              participant.id
                ?.split('@')[0] ===
              lidBase
            ) {
              return participant.id;
            }
          }
        }

        return normalized;
      };

    msg.mentionedJid =
      rawMentioned
        .map(resolveMention)
        .filter(Boolean);

    msg.text =
      msg.msg?.text ||
      msg.msg?.caption ||
      msg.message?.conversation ||
      msg.msg?.contentText ||
      msg.msg?.selectedDisplayText ||
      msg.msg?.title ||
      '';

    const botId =
      furina.user?.id
        ?.split(':')[0] +
      '@s.whatsapp.net';

   let settings = {};

if (botId) {
  try {
    settings = await db.getSettings(botId);
  } catch {
    settings = {};
  }
}

    let prefixes;

    if (
      settings?.prefijo === 1
    ) {
      prefixes = [];
    } else if (
      Array.isArray(
        settings?.prefijo
      )
    ) {
      prefixes =
        settings.prefijo;
    } else if (
      typeof settings?.prefijo ===
      'string'
    ) {
      prefixes =
        splitter.splitGraphemes(
          settings.prefijo
        );
    } else {
      prefixes = [
        '#',
        '/',
        '-',
        '+',
        '.',
        '!'
      ];
    }

    msg.usedPrefix = '';

    for (
      const prefix of prefixes
    ) {
      if (
        msg.body?.startsWith(
          prefix
        )
      ) {
        msg.usedPrefix =
          prefix;
        break;
      }
    }

    const withoutPrefix =
      msg.body
        ?.slice(
          msg.usedPrefix.length
        )
        .trim() || '';

    msg.command =
      withoutPrefix
        .split(/\s+/)
        .shift() || '';

    msg.args =
      withoutPrefix
        .split(/\s+/)
        .slice(1)
        .filter(Boolean);

    msg.device =
      getDevice(msg.id);

    msg.expiration =
      msg.msg?.contextInfo
        ?.expiration ||
      0;

    msg.timestamp =
      typeof msg.messageTimestamp ===
      'number'
        ? msg.messageTimestamp
        : msg.messageTimestamp
            ?.low ||
          msg.messageTimestamp
            ?.high ||
          0;

    msg.isMedia =
      !!msg.msg?.mimetype ||
      !!msg.msg?.thumbnailDirectPath;

    if (msg.isMedia) {
      msg.mime =
        msg.msg?.mimetype;

      msg.size =
        msg.msg?.fileLength;

      msg.height =
        msg.msg?.height || '';

      msg.width =
        msg.msg?.width || '';

      if (
        /webp/i.test(
          msg.mime || ''
        )
      ) {
        msg.isAnimated =
          !!msg.msg?.isAnimated;
      }
    }


    const quotedMessage =
      msg.msg?.contextInfo
        ?.quotedMessage;

    msg.quoted =
      quotedMessage
        ? {}
        : null;

    if (msg.quoted) {
      msg.quoted.message =
        extractMessageContent(
          quotedMessage
        );

      msg.quoted.type =
        getContentType(
          msg.quoted.message
        ) ||
        Object.keys(
          msg.quoted.message || {}
        )[0];

      msg.quoted.msg =
        extractMessageContent(
          msg.quoted.message?.[
            msg.quoted.type
          ]
        ) ||
        msg.quoted.message?.[
          msg.quoted.type
        ];

      msg.quoted.id =
        msg.msg.contextInfo
          .stanzaId;

      msg.quoted.chat =
        msg.msg.contextInfo
          .remoteJid ||
        msg.chat;

      const rawQuotedSender =
        msg.msg.contextInfo
          .participant || '';

      msg.quoted.sender =
        await resolveJidAsync(
          furina.decodeJid(
            rawQuotedSender
          ),
          furina,
          msg.chat
        );

      msg.quoted.fromMe =
        areJidsSameUser(
          msg.quoted.sender,
          furina.decodeJid(
            furina.user?.id
          )
        );

      msg.quoted.text =
        msg.quoted.msg?.text ||
        msg.quoted.msg?.caption ||
        msg.quoted.msg?.conversation ||
        msg.quoted.msg?.contentText ||
        msg.quoted.msg?.selectedDisplayText ||
        msg.quoted.msg?.title ||
        '';

      msg.quoted.body =
        msg.quoted.msg?.text ||
        msg.quoted.msg?.caption ||
        msg.quoted.message
          ?.conversation ||
        msg.quoted.msg
          ?.selectedButtonId ||
        msg.quoted.msg
          ?.singleSelectReply
          ?.selectedRowId ||
        msg.quoted.msg?.selectedId ||
        msg.quoted.msg?.contentText ||
        msg.quoted.msg
          ?.selectedDisplayText ||
        msg.quoted.msg?.title ||
        msg.quoted.msg?.name ||
        '';

      msg.quoted.mentionedJid =
        (
          msg.quoted.msg
            ?.contextInfo
            ?.mentionedJid || []
        )
          .map(resolveMention)
          .filter(Boolean);

      msg.quoted.mentions =
        msg.quoted.mentionedJid;

      msg.quoted.isGroup =
        msg.quoted.chat?.endsWith(
          '@g.us'
        ) || false;

      let quotedPrefix = '';

      for (
        const prefix of prefixes
      ) {
        if (
          msg.quoted.body?.startsWith(
            prefix
          )
        ) {
          quotedPrefix =
            prefix;
          break;
        }
      }

      msg.quoted.usedPrefix =
        quotedPrefix;

      const quotedWithoutPrefix =
        msg.quoted.body
          ?.slice(
            quotedPrefix.length
          )
          .trim() || '';

      msg.quoted.command =
        quotedWithoutPrefix
          .split(/\s+/)
          .shift() || '';

      msg.quoted.isMedia =
        !!msg.quoted.msg?.mimetype ||
        !!msg.quoted.msg
          ?.thumbnailDirectPath;

      if (
        msg.quoted.isMedia
      ) {
        msg.quoted.mime =
          msg.quoted.msg?.mimetype;

        msg.quoted.size =
          msg.quoted.msg?.fileLength;

        msg.quoted.height =
          msg.quoted.msg?.height ||
          '';

        msg.quoted.width =
          msg.quoted.msg?.width ||
          '';
      }

      msg.quoted.key = {
        remoteJid:
          msg.msg.contextInfo
            ?.remoteJid ||
          msg.chat,

        participant:
          msg.quoted.sender,

        fromMe:
          msg.quoted.fromMe,

        id:
          msg.quoted.id
      };

      msg.quoted.fakeObj =
        proto.WebMessageInfo.fromObject(
          {
            key: {
              remoteJid:
                msg.quoted.chat,

              fromMe:
                msg.quoted.fromMe,

              id:
                msg.quoted.id
            },

            message:
              msg.quoted.message,

            ...(msg.isGroup
              ? {
                  participant:
                    msg.quoted.sender
                }
              : {})
          }
        );

      msg.quoted.download =
        () =>
          furina.downloadMediaMessage(
            msg.quoted
          );

      msg.quoted.delete =
        async () =>
          furina.sendMessage(
            msg.quoted.chat,
            {
              delete:
                msg.quoted.key
            }
          );
    }
  }


  msg.download =
    () =>
      furina.downloadMediaMessage(
        msg
      );

  msg.copy =
    () =>
      proto.WebMessageInfo.fromObject(
        proto.WebMessageInfo.toObject(
          msg
        )
      );

  msg.react =
    emoji =>
      furina.sendMessage(
        msg.chat,
        {
          react: {
            text: emoji,
            key: msg.key
          }
        }
      );

  msg.copyNForward =
    (
      jid = msg.chat,
      forceForward = false,
      options = {}
    ) =>
      furina.copyNForward?.(
        jid,
        msg,
        forceForward,
        options
      );

  msg.reply =
    async (
      content,
      options = {}
    ) => {
      if (
        typeof content ===
        'string'
      ) {
        return furina.sendMessage(
          msg.chat,
          {
            text: content,
            ...options
          },
          {
            quoted: msg
          }
        );
      }

      if (
        content &&
        typeof content ===
          'object'
      ) {
        return furina.sendMessage(
          msg.chat,
          content,
          {
            ...options,
            quoted: msg
          }
        );
      }

      return null;
    };

  if (!furina.parseMention) {
    furina.parseMention =
      text =>
        [
          ...String(
            text || ''
          ).matchAll(
            /@([0-9]{5,16}|0)/g
          )
        ].map(
          match =>
            `${match[1]}@s.whatsapp.net`
        );
  }

  if (
    !furina.sendImageAsSticker
  ) {
    furina.sendImageAsSticker =
      async (
        jid,
        input,
        quoted,
        options = {}
      ) => {
        const buffer =
          Buffer.isBuffer(input)
            ? input
            : /^data:.*?\/.*?;base64,/i.test(
                input
              )
              ? Buffer.from(
                  input.split(',')[1],
                  'base64'
                )
              : /^https?:\/\//.test(
                  input
                )
                ? await getBuffer(
                    input
                  )
                : fs.existsSync(input)
                  ? fs.readFileSync(
                      input
                    )
                  : Buffer.alloc(0);

        if (!buffer.length) {
          throw new Error(
            'لم يتم العثور على الصورة'
          );
        }

        const sticker =
          options.packname ||
          options.author
            ? await writeExifImg(
                buffer,
                options
              )
            : await imageToWebp(
                buffer
              );

        await furina.sendMessage(
          jid,
          {
            sticker: {
              url: sticker
            }
          },
          {
            quoted
          }
        );

        return sticker;
      };
  }

  if (
    !furina.sendVideoAsSticker
  ) {
    furina.sendVideoAsSticker =
      async (
        jid,
        input,
        quoted,
        options = {}
      ) => {
        const buffer =
          Buffer.isBuffer(input)
            ? input
            : /^data:.*?\/.*?;base64,/i.test(
                input
              )
              ? Buffer.from(
                  input.split(',')[1],
                  'base64'
                )
              : /^https?:\/\//.test(
                  input
                )
                ? await getBuffer(
                    input
                  )
                : fs.existsSync(input)
                  ? fs.readFileSync(
                      input
                    )
                  : Buffer.alloc(0);

        if (!buffer.length) {
          throw new Error(
            'لم يتم العثور على الفيديو'
          );
        }

        const sticker =
          options.packname ||
          options.author
            ? await writeExifVid(
                buffer,
                options
              )
            : await videoToWebp(
                buffer
              );

        await furina.sendMessage(
          jid,
          {
            sticker: {
              url: sticker
            }
          },
          {
            quoted
          }
        );

        return sticker;
      };
  }


  if (
    !furina.sendAlbumMessage
  ) {
    furina.sendAlbumMessage =
      async (
        jid,
        medias,
        options = {}
      ) => {
        if (
          typeof jid !==
          'string'
        ) {
          throw new TypeError(
            'jid يجب أن يكون نصًا'
          );
        }

        if (
          !Array.isArray(
            medias
          ) ||
          medias.length < 2
        ) {
          throw new RangeError(
            'الألبوم يحتاج إلى وسيلتين على الأقل'
          );
        }

        for (
          const media of medias
        ) {
          if (
            !media?.type ||
            ![
              'image',
              'video'
            ].includes(
              media.type
            )
          ) {
            throw new TypeError(
              `نوع الوسائط غير صالح: ${media?.type}`
            );
          }

          if (
            !media.data ||
            (
              !media.data.url &&
              !Buffer.isBuffer(
                media.data
              )
            )
          ) {
            throw new TypeError(
              'بيانات الوسائط غير صالحة'
            );
          }
        }

        const delayMs =
          Number.isFinite(
            options.delay
          )
            ? options.delay
            : 500;

        const caption =
          options.text ||
          options.caption ||
          '';

        const {
          text,
          caption: removedCaption,
          delay: removedDelay,
          ...albumOptions
        } = options;

        const album =
          generateWAMessageFromContent(
            jid,
            {
              messageContextInfo: {},

              albumMessage: {
                expectedImageCount:
                  medias.filter(
                    media =>
                      media.type ===
                      'image'
                  ).length,

                expectedVideoCount:
                  medias.filter(
                    media =>
                      media.type ===
                      'video'
                  ).length,

                ...(albumOptions.quoted
                  ? {
                      contextInfo: {
                        remoteJid:
                          albumOptions
                            .quoted
                            .key
                            .remoteJid,

                        fromMe:
                          albumOptions
                            .quoted
                            .key
                            .fromMe,

                        stanzaId:
                          albumOptions
                            .quoted
                            .key
                            .id,

                        participant:
                          albumOptions
                            .quoted
                            .key
                            .participant,

                        quotedMessage:
                          albumOptions
                            .quoted
                            .message
                      }
                    }
                  : {})
              }
            },
            {}
          );

        await furina.relayMessage(
          album.key.remoteJid,
          album.message,
          {
            messageId:
              album.key.id
          }
        );

        for (
          let i = 0;
          i < medias.length;
          i++
        ) {
          const media =
            medias[i];

          const mediaMessage =
            await generateWAMessage(
              album.key.remoteJid,
              {
                [media.type]:
                  media.data,

                ...(media.caption
                  ? {
                      caption:
                        media.caption
                    }
                  : {})
              },
              {
                upload:
                  furina.waUploadToServer
              }
            );

          mediaMessage.message
            .messageContextInfo = {
            messageAssociation: {
              associationType: 1,
              parentMessageKey:
                album.key
            }
          };

          await furina.relayMessage(
            mediaMessage.key
              .remoteJid,
            mediaMessage.message,
            {
              messageId:
                mediaMessage.key.id
            }
          );

          await delay(
            delayMs
          );
        }

        return album;
      };
  }


  if (!furina.reply) {
    furina.reply =
      async (
        jid,
        text = '',
        quoted,
        options = {}
      ) => {
        if (
          Buffer.isBuffer(text)
        ) {
          return furina.sendMessage(
            jid,
            {
              document: text,

              fileName:
                options.fileName ||
                'file',

              mimetype:
                options.mimetype ||
                'application/octet-stream',

              caption:
                options.caption ||
                ''
            },
            {
              quoted
            }
          );
        }

        return furina.sendMessage(
          jid,
          {
            text,
            ...options
          },
          {
            quoted
          }
        );
      };
  }

  return msg;
}


export {
  normalizeJid,
  resolveParticipantJid,
  resolveJidSync,
  resolveJidAsync,
  patchGroupMetadata,
  getCachedMeta,
  setCachedMeta,
  deleteCachedMeta
};

export default {
  smsg,
  getBuffer,
  normalizeJid,
  resolveParticipantJid,
  resolveJidSync,
  resolveJidAsync,
  patchGroupMetadata,
  getCachedMeta,
  setCachedMeta,
  deleteCachedMeta
};
