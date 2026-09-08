import "./settings.js";
import "#db";
import handler from '#handler';
import events from '#events';
import makeWASocket, {
  Browsers,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidDecode,
  DisconnectReason
} from 'baileys';
import pino from "pino";
import qrcode from "qrcode-terminal";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import readlineSync from "readline-sync";
import { smsg, getCachedMeta, setCachedMeta } from "#serialize";
import cmdsLoader from '#cmdsloader';
import db from '#db';

const log = {
  info: (msg) =>
    console.log(
      chalk.bgBlue.white.bold(` INFO `),
      chalk.white(msg)
    ),

  success: (msg) =>
    console.log(
      chalk.bgGreen.white.bold(` SUCCESS `),
      chalk.greenBright(msg)
    ),

  warn: (msg) =>
    console.log(
      chalk.bgYellowBright.blueBright.bold(` تحذير `),
      chalk.yellow(msg)
    ),

  error: (msg) =>
    console.log(
      chalk.bgRed.white.bold(` خطأ `),
      chalk.redBright(msg)
    )
};

let phoneNumber = "";
let phoneInput = "";

let lineM = '⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》';

const methodCodeQR = process.argv.includes("--qr");
const methodCode = process.argv.includes("code");

function normalizePhone(input) {
  let s = String(input).replace(/\D/g, '');

  if (!s) return '';

  if (s.startsWith('0')) {
    s = s.replace(/^0+/, '');
  }

  if (s.length === 10 && s.startsWith('3')) {
    s = '57' + s;
  }

  if (
    s.startsWith('52') &&
    !s.startsWith('521') &&
    s.length >= 12
  ) {
    s = '521' + s.slice(2);
  }

  if (
    s.startsWith('54') &&
    !s.startsWith('549') &&
    s.length >= 11
  ) {
    s = '549' + s.slice(2);
  }

  return s;
}

console.log(
  chalk.blue.bold('\n جارٍ تشغيل النظام ...')
);

console.log(
  chalk.cyan(`
      Furina | Wa Bot
     مدعوم بواسطة Furina
`)
);

if (!fs.existsSync('./lib/system/tmp')) {
  fs.mkdirSync('./lib/system/tmp', {
    recursive: true
  });
}

global.conns = global.conns || [];

const msgStore = new Map();
const msgLimit = 500;

async function initDB() {
  try {
    db.initDB();

    db.clearCache('user');
    db.clearCache('chat');
    db.clearCache('set');
    db.clearCache('chatuser');
    db.clearCache('packsticker');

    log.info('تم تهيئة قاعدة البيانات.');
  } catch (e) {
    log.error(
      `خطأ في قاعدة البيانات: ${e.message}`
    );
  }
}

function clearSession() {
  try {
    const sessionDir = './Sessions/Owner';

    if (!fs.existsSync(sessionDir)) {
      return;
    }

    for (const file of fs.readdirSync(sessionDir)) {
      try {
        fs.unlinkSync(
          path.join(sessionDir, file)
        );
      } catch {}
    }

    log.warn(
      'تم حذف جلسة الحساب الرئيسي — إعادة التشغيل لربطه من جديد...'
    );
  } catch (e) {
    log.error(
      `clearSession → ${e?.message || e}`
    );
  }
}

let opcion;

if (methodCodeQR) {
  opcion = "1";

} else if (methodCode) {

  opcion = "2";

  if (!phoneNumber) {

    console.log(
      chalk.bold.redBright(
        `\nمن فضلك أدخل رقم WhatsApp.\n${
          chalk.bold.yellowBright(
            "مثال: +57301******"
          )
        }\n${
          chalk.bold.magentaBright('---> ')
        }`
      )
    );

    phoneInput = readlineSync.question("");

    phoneNumber = normalizePhone(phoneInput);
  }

} else if (!fs.existsSync("./Sessions/Owner/creds.json")) {

  opcion = readlineSync.question(
    `╭${lineM}  
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.blue.bgBlue.bold.cyan('طريقة الربط')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}   
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}     
┊ ${chalk.blueBright('┊')} ${chalk.green.bgMagenta.bold.yellow('كيف تريد الاتصال؟')}
┊ ${chalk.blueBright('┊')} ${chalk.bold.redBright('=> الخيار 1:')} ${chalk.greenBright('رمز QR.')}
┊ ${chalk.blueBright('┊')} ${chalk.bold.redBright('=> الخيار 2:')} ${chalk.greenBright('رمز مكوّن من 8 أرقام.')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}     
┊ ${chalk.blueBright('┊')} ${chalk.italic.magenta('اكتب رقم الخيار فقط')}
┊ ${chalk.blueBright('┊')} ${chalk.italic.magenta('الذي تريد الاتصال به.')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
╰${lineM}\n${
      chalk.bold.magentaBright('---> ')
    }`
  );

  while (!/^[1-2]$/.test(opcion)) {

    console.log(
      chalk.bold.redBright(
        `لا يُسمح بأرقام غير 1 أو 2، ولا بالحروف أو الرموز الخاصة.`
      )
    );

    opcion = readlineSync.question("--> ");
  }

  if (opcion === "2") {

    console.log(
      chalk.bold.redBright(
        `\nمن فضلك أدخل رقم WhatsApp.\n${
          chalk.bold.yellowBright(
            "مثال: +57301******"
          )
        }\n${
          chalk.bold.magentaBright('---> ')
        }`
      )
    );

    phoneInput = readlineSync.question("");

    phoneNumber = normalizePhone(phoneInput);
  }
}

let bootTime = Date.now();

let reconexion = 0;
let botReady = false;
let isRestarting = false;

const retriesLimit = 15;

async function warmupGroups(furina) {
  try {

    const allChats = db.getChat();

    const chatIds = allChats
      .map(c => c.id)
      .filter(
        id =>
          typeof id === 'string' &&
          id.endsWith('@g.us')
      )
      .slice(0, 50);

    if (!chatIds.length) return;

    console.log(
      chalk.gray(
        `[ ✿ ] جارٍ تحميل بيانات ${chatIds.length} مجموعة مسبقًا...`
      )
    );

    const t = Date.now();

    const batches = [];

    for (
      let i = 0;
      i < chatIds.length;
      i += 10
    ) {
      batches.push(
        chatIds.slice(i, i + 10)
      );
    }

    await Promise.allSettled(
      batches.map(batch =>
        Promise.allSettled(
          batch.map(async id => {

            try {

              const meta =
                await furina.groupMetadata(id);

              if (meta) {
                setCachedMeta(id, meta);
              }

            } catch {}
          })
        )
      )
    );

    console.log(
      chalk.gray(
        `[ ✿ ] اكتمل التحميل المسبق خلال ${
          Date.now() - t
        }ms`
      )
    );

  } catch (e) {

    console.log(
      chalk.gray(
        `[ ✿ ] warmupGroups → ${
          e?.message || e
        }`
      )
    );
  }
}

export async function startBot() {

  if (isRestarting) return;

  isRestarting = true;

  bootTime = Date.now();

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    './Sessions/Owner'
  );

  const { version } =
    await fetchLatestBaileysVersion();

  console.info = () => {};
  console.debug = () => {};

  const furina = makeWASocket({

    version,

    logger: pino({
      level: 'silent'
    }),

    browser: Browsers.macOS('Chrome'),

    printQRInTerminal: false,

    auth: {
      creds: state.creds,

      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({
          level: 'silent'
        })
      )
    },

    markOnlineOnConnect: false,

    syncFullHistory: false,

    generateHighQualityLinkPreview: true,

    shouldIgnoreJid: jid =>
      jid.endsWith('@broadcast'),

    keepAliveIntervalMs: 25_000,

    getMessage: async key =>
      msgStore.get(
        key.remoteJid + ':' + key.id
      )
  });

  global.furina = furina;

  furina.ev.on(
    "creds.update",
    saveCreds
  );

  furina.sendText = (
    jid,
    text,
    quoted = "",
    options
  ) =>
    furina.sendMessage(
      jid,
      {
        text,
        ...options
      },
      {
        quoted
      }
    );

  furina.decodeJid = jid => {

    if (!jid) return jid;

    if (/:\d+@/gi.test(jid)) {

      const decode =
        jidDecode(jid) || {};

      return (
        (
          decode.user &&
          decode.server &&
          decode.user +
          "@" +
          decode.server
        ) ||
        jid
      );
    }

    return jid;
  };

  if (
    opcion === "2" &&
    !state.creds.registered
  ) {

    setTimeout(async () => {

      try {

        if (!state.creds.registered) {

          const pairing =
            await furina.requestPairingCode(
              phoneNumber
            );

          const codeBot =
            pairing
              ?.match(/.{1,4}/g)
              ?.join("-") ||
            pairing;

          console.log(
            chalk.bold.white(
              chalk.bgMagenta(
                `رمز الاقتران:`
              )
            ),
            chalk.bold.white(
              chalk.white(codeBot)
            )
          );
        }

      } catch (err) {

        console.log(
          chalk.red(
            "خطأ أثناء إنشاء الرمز:"
          ),
          err
        );
      }

    }, 3000);
  }

  furina.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {

      if (!botReady) return;

      if (type !== 'notify') return;

      for (const msg of messages) {

        if (
          msg?.message &&
          msg?.key?.id
        ) {

          const sid =
            msg.key.remoteJid +
            ':' +
            msg.key.id;

          msgStore.set(
            sid,
            msg.message
          );

          if (
            msgStore.size >
            msgLimit
          ) {
            msgStore.delete(
              msgStore
                .keys()
                .next()
                .value
            );
          }
        }

        try {

          if (
            !msg?.message ||
            msg.key?.remoteJid ===
              "status@broadcast"
          ) {
            continue;
          }

          if (
            (msg.messageTimestamp * 1000) <
            bootTime - 15_000
          ) {
            continue;
          }

          if (
            msg.message.ephemeralMessage
          ) {
            msg.message =
              msg.message
                .ephemeralMessage
                .message;
          }

          const m =
            await smsg(
              furina,
              msg
            );

          if (
            typeof handler === 'function'
          ) {

            handler(
              furina,
              m,
              messages
            ).catch(
              err =>
                console.error(
                  '[ ✿ ] الحساب الرئيسي »',
                  err?.message
                )
            );
          }

        } catch (err) {

          console.error(
            'خطأ:',
            err
          );
        }
      }
    }
  );

  try {

    await events(
      furina,
      null
    );

  } catch (err) {

    console.log(
      chalk.gray(
        `[ خطأ الأحداث ] → ${err}`
      )
    );
  }

  furina.ev.on(
    "connection.update",
    async update => {

      const {
        qr,
        connection,
        lastDisconnect,
        isNewLogin,
        receivedPendingNotifications
      } = update;

      if (
        qr != 0 &&
        qr != undefined ||
        methodCodeQR
      ) {

        if (
          opcion == '1' ||
          methodCodeQR
        ) {

          console.log(
            chalk.green.bold(
              "[ ✿ ] امسح رمز QR هذا"
            )
          );

          qrcode.generate(
            qr,
            {
              small: true
            }
          );
        }
      }

      if (
        connection === "open"
      ) {

        bootTime = Date.now();

        reconexion = 0;

        isRestarting = false;

        const userName =
          furina.user.name ||
          "غير معروف";

        log.success(
          `تم الاتصال بـ: ${userName}`
        );

        if (!botReady) {

          botReady = true;

          warmupGroups(
            furina
          );
        }
      }

      if (isNewLogin) {

        log.info(
          "تم اكتشاف جهاز جديد"
        );
      }

      if (
        receivedPendingNotifications === true
      ) {

        log.warn(
          "يرجى الانتظار حوالي دقيقة واحدة..."
        );

        furina.ev.flush();
      }

      if (
        connection === "close"
      ) {

        const reason =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode ||
          0;

        if (
          [
            DisconnectReason.loggedOut,
            DisconnectReason.forbidden,
            DisconnectReason.multideviceMismatch
          ].includes(reason)
        ) {

          log.warn(
            `تم فصل الحساب الرئيسي (${reason}) — جارٍ تنظيف الجلسة وإعادة التشغيل...`
          );

          botReady = false;

          isRestarting = false;

          clearSession();

          process.exit(1);
        }

        if (
          reason ===
          DisconnectReason.connectionReplaced
        ) {

          log.warn(
            "تم استبدال الاتصال — أغلق الجلسة الأخرى قبل إعادة الاتصال."
          );

          isRestarting = false;

          return;
        }

        reconexion++;

        if (
          reconexion >
          retriesLimit
        ) {

          log.error(
            `تم تجاوز عدد محاولات إعادة الاتصال (${retriesLimit}) — قد تكون الجلسة تالفة، جارٍ تنظيفها...`
          );

          botReady = false;

          reconexion = 0;

          isRestarting = false;

          clearSession();

          process.exit(1);
        }

        const delay =
          Math.min(
            3000 * reconexion,
            30000
          );

        const reasonMessages = {

          [DisconnectReason.connectionLost]:
            "تم فقدان الاتصال بالخادم، جارٍ محاولة إعادة الاتصال...",

          [DisconnectReason.connectionClosed]:
            "تم إغلاق الاتصال، جارٍ محاولة إعادة الاتصال...",

          [DisconnectReason.restartRequired]:
            "يجب إعادة تشغيل الاتصال...",

          [DisconnectReason.timedOut]:
            "انتهت مهلة الاتصال، جارٍ محاولة إعادة الاتصال...",

          [DisconnectReason.badSession]:
            "الجلسة غير صالحة، جارٍ تنظيفها وإعادة الاتصال..."
        };

        log.warn(
          reasonMessages[reason] ||
          `تم قطع الاتصال (${reason})، جارٍ إعادة الاتصال خلال ${
            delay / 1000
          } ثوانٍ...`
        );

        isRestarting = false;

        setTimeout(
          startBot,
          delay
        );
      }
    }
  );
}

(async () => {

  await initDB();

  await cmdsLoader();

  await startBot();

})();
