import "./settings.js";
import "#db";
import handler from "#handler";
import events from "./lib/events.js";
import makeWASocket, {
  Browsers,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidDecode,
  DisconnectReason
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import readlineSync from "readline-sync";
import { smsg, getCachedMeta, setCachedMeta } from "#serialize";
import cmdsLoader from "./lib/cmdsloader.js";
import db from "#db";

const log = {
  info: msg => console.log(chalk.bgBlue.white.bold(` INFO `), chalk.white(msg)),
  success: msg => console.log(chalk.bgGreen.white.bold(` SUCCESS `), chalk.greenBright(msg)),
  warn: msg => console.log(chalk.bgYellowBright.blueBright.bold(` warning `), chalk.yellow(msg)),
  error: msg => console.log(chalk.bgRed.white.bold(`ERROR`), chalk.redBright(msg))
};

let phoneNumber = "";
let phoneInput = "";
let lineM = "⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》";

const methodCodeQR = process.argv.includes("--qr");
const methodCode = process.argv.includes("code");

function normalizePhone(input) {
  let s = String(input).replace(/\D/g, "");

  if (!s) return "";

  if (s.startsWith("0")) {
    s = s.replace(/^0+/, "");
  }

  if (s.length === 10 && s.startsWith("3")) {
    s = "57" + s;
  }

  if (s.startsWith("52") && !s.startsWith("521") && s.length >= 12) {
    s = "521" + s.slice(2);
  }

  if (s.startsWith("54") && !s.startsWith("549") && s.length >= 11) {
    s = "549" + s.slice(2);
  }

  return s;
}

console.log(chalk.blue.bold("\n System is running ..."));

console.log(chalk.cyan(`
      Furina | Wa Bot
 Furina
`));

if (!fs.existsSync("./lib/system/tmp")) {
  fs.mkdirSync("./lib/system/tmp", { recursive: true });
}

global.conns = global.conns || [];

const msgStore = new Map();
const msgLimit = 500;

async function initDB() {
  try {
    db.initDB();
    db.clearCache("user");
    db.clearCache("chat");
    db.clearCache("set");
    db.clearCache("chatuser");
    db.clearCache("packsticker");

    log.info("The database has been configured.");
  } catch (e) {
    log.error(`Database error: ${e.message}`);
  }
}

function clearSession() {
  try {
    const sessionDir = "./Sessions/Owner";

    if (!fs.existsSync(sessionDir)) {
      return;
    }

    for (const file of fs.readdirSync(sessionDir)) {
      try {
        fs.unlinkSync(path.join(sessionDir, file));
      } catch {}
    }

    log.warn("The main account session was deleted — restart to reconnect....");
  } catch (e) {
    log.error(`clearSession → ${e?.message || e}`);
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
        `\n Please enter the number WhatsApp.\n${chalk.bold.yellowBright(
          "example: +2010******"
        )}\n${chalk.bold.magentaBright("---> ")}`
      )
    );

    phoneInput = readlineSync.question("");
    phoneNumber = normalizePhone(phoneInput);
  }
} else if (!fs.existsSync("./Sessions/Owner/creds.json")) {
  opcion = readlineSync.question(
    `╭${lineM}
┊ ${chalk.blueBright("╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
┊ ${chalk.blueBright("┊")} ${chalk.blue.bgBlue.bold.cyan("Connection Method")}
┊ ${chalk.blueBright("╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
┊ ${chalk.blueBright("╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
┊ ${chalk.blueBright("┊")} ${chalk.green.bgMagenta.bold.yellow("How do you want to connect?")}
┊ ${chalk.blueBright("┊")} ${chalk.bold.redBright("=> Option 1:")} ${chalk.greenBright("QR code.")}
┊ ${chalk.blueBright("┊")} ${chalk.bold.redBright("=> Option 2:")} ${chalk.greenBright("8-digit code.")}
┊ ${chalk.blueBright("╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
┊ ${chalk.blueBright("╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
┊ ${chalk.blueBright("┊")} ${chalk.italic.magenta("Enter the option number only")}
┊ ${chalk.blueBright("┊")} ${chalk.italic.magenta("that you want to use.")}
┊ ${chalk.blueBright("╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅")}
╰${lineM}\n${chalk.bold.magentaBright("---> ")}`
  );

  while (!/^[1-2]$/.test(opcion)) {
    console.log(
      chalk.bold.redBright(
        "Numbers other than 1 or 2, and special letters or symbols are not allowed.."
      )
    );

    opcion = readlineSync.question("--> ");
  }

  if (opcion === "2") {
    console.log(
      chalk.bold.redBright(
        `\n Please enter the number WhatsApp.\n${chalk.bold.yellowBright(
          "example: +2010******"
        )}\n${chalk.bold.magentaBright("---> ")}`
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
          typeof id === "string" &&
          id.endsWith("@g.us")
      )
      .slice(0, 50);

    if (!chatIds.length) {
      return;
    }

    console.log(
      chalk.gray(
        `[ ✿ ] Data loading ${chatIds.length} Pre-set...`
      )
    );

    const t = Date.now();
    const batches = [];

    for (let i = 0; i < chatIds.length; i += 10) {
      batches.push(chatIds.slice(i, i + 10));
    }

    await Promise.allSettled(
      batches.map(batch =>
        Promise.allSettled(
          batch.map(async id => {
            try {
              const meta = await furina.groupMetadata(id);

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
        `[ ✿ ] Preloading completed within ${Date.now() - t}ms`
      )
    );
  } catch (e) {
    console.log(
      chalk.gray(
        `[ ✿ ] warmupGroups → ${e?.message || e}`
      )
    );
  }
}

export async function startBot() {
  if (isRestarting) {
    return;
  }

  isRestarting = true;
  bootTime = Date.now();

  const { state, saveCreds } =
    await useMultiFileAuthState("./Sessions/Owner");

  const { version } =
    await fetchLatestBaileysVersion();

  console.info = () => {};
  console.debug = () => {};

  const furina = makeWASocket({
    version,

    logger: pino({
      level: "silent"
    }),

    browser: Browsers.macOS("Chrome"),

    printQRInTerminal: false,

    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({
          level: "silent"
        })
      )
    },

    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,

    shouldIgnoreJid: jid =>
      jid.endsWith("@broadcast"),

    keepAliveIntervalMs: 25_000,

    getMessage: async key =>
      msgStore.get(
        key.remoteJid + ":" + key.id
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
    if (!jid) {
      return jid;
    }

    if (/:\\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};

      return (
        (decode.user &&
          decode.server &&
          decode.user + "@" + decode.server) ||
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
              chalk.bgMagenta("Pairing code:")
            ),
            chalk.bold.white(
              chalk.white(codeBot)
            )
          );
        }
      } catch (err) {
        console.log(
          chalk.red(
            "Error while generating the code:"
          ),
          err
        );
      }
    }, 3000);
  }

  furina.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {
      if (!botReady) {
        return;
      }

      if (type !== "notify") {
        return;
      }

      for (const msg of messages) {
        if (
          msg?.message &&
          msg?.key?.id
        ) {
          const sid =
            msg.key.remoteJid +
            ":" +
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
              msgStore.keys().next().value
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
            msg.messageTimestamp * 1000 <
            bootTime - 15_000
          ) {
            continue;
          }

          if (
            msg.message.ephemeralMessage
          ) {
            msg.message =
              msg.message.ephemeralMessage.message;
          }

          const m = await smsg(
            furina,
            msg
          );

          if (
            typeof handler === "function"
          ) {
            handler(
              furina,
              m,
              messages
            ).catch(
              err =>
                console.error(
                  "[ ✿ ] Main account »",
                  err?.message
                )
            );
          }
        } catch (err) {
          console.error(
            "Error:",
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
        `[ Events Error ] → ${err}`
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
        (qr != 0 &&
          qr != undefined) ||
        methodCodeQR
      ) {
        if (
          opcion == "1" ||
          methodCodeQR
        ) {
          console.log(
            chalk.green.bold(
              "[ ✿ ] Scan this QR code"
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
          "Unknown";

        log.success(
          `Connected to: ${userName}`
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
          "New device detected"
        );
      }

      if (
        receivedPendingNotifications === true
      ) {
        log.warn(
          "Please wait about one minute..."
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
            `Main account disconnected (${reason}) — cleaning session and restarting...`
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
            "Connection replaced — close the other session before reconnecting."
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
            `Reconnect attempt limit (${retriesLimit}) exceeded — the session may be corrupted, cleaning it...`
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
            "Connection to the server was lost, attempting to reconnect...",

          [DisconnectReason.connectionClosed]:
            "Connection closed, attempting to reconnect...",

          [DisconnectReason.restartRequired]:
            "Connection restart required...",

          [DisconnectReason.timedOut]:
            "Connection timed out, attempting to reconnect...",

          [DisconnectReason.badSession]:
            "Invalid session, cleaning it and reconnecting..."
        };

        log.warn(
          reasonMessages[reason] ||
            `Connection closed (${reason}), reconnecting in ${
              delay / 1000
            } seconds...`
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
