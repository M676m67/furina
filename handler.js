import db from '#db';
import moment from 'moment';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCachedMeta, setCachedMeta } from '#serialize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!(global.comandos instanceof Map)) {
  global.comandos = new Map();
}

if (!(global.cmdsExecute instanceof Array)) {
  global.cmdsExecute = [];
}

if (!(global.plugins instanceof Object)) {
  global.plugins = {};
}

if (!Array.isArray(global.owner)) {
  global.owner = [];
}

if (!Array.isArray(global.mods)) {
  global.mods = [];
}

const commandsPath = path.join(__dirname, 'cmds');


function normalizeNumber(number) {
  return String(number || '')
    .replace(/[^0-9]/g, '');
}

function toJid(number) {
  const clean = normalizeNumber(number);

  if (!clean) return '';

  return `${clean}@s.whatsapp.net`;
}

function getOwnerJids() {
  return global.owner
    .map(toJid)
    .filter(Boolean);
}

function getModsJids() {
  return global.mods
    .map(toJid)
    .filter(Boolean);
}

function escapeRegex(text) {
  return String(text)
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function getSenderJid(msg) {
  return (
    msg?.sender ||
    msg?.key?.participant ||
    msg?.participant ||
    ''
  );
}

function getBotJid(furina) {
  return (
    furina?.user?.id?.split(':')[0] ||
    furina?.user?.lid?.split(':')[0] ||
    ''
  );
}

function isAdminParticipant(participant, jid) {
  if (!participant || !jid) return false;

  const target = jid.split('@')[0];

  const ids = [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ]
    .filter(Boolean)
    .map(x => String(x).split('@')[0]);

  return (
    ids.includes(target) &&
    (
      participant.admin === 'admin' ||
      participant.admin === 'superadmin'
    )
  );
}


async function getGroupData(furina, msg) {
  if (!msg?.isGroup) {
    return {
      groupMetadata: null,
      participants: [],
      isAdmins: false,
      isBotAdmins: false
    };
  }

  let groupMetadata = getCachedMeta(msg.chat);

  if (!groupMetadata) {
    try {
      groupMetadata = await furina.groupMetadata(msg.chat);

      if (groupMetadata) {
        setCachedMeta(msg.chat, groupMetadata);
      }
    } catch {
      groupMetadata = null;
    }
  }

  const participants = groupMetadata?.participants || [];

  const sender = getSenderJid(msg);
  const botJid = getBotJid(furina);

  const isAdmins = participants.some(
    p => isAdminParticipant(p, sender)
  );

  const isBotAdmins = participants.some(
    p => isAdminParticipant(p, botJid)
  );

  return {
    groupMetadata,
    participants,
    isAdmins,
    isBotAdmins
  };
}



function createPrefix(settings) {
  const rawBotname = settings?.namebot2 || 'Furina';
  const type = settings?.type || 'Furina';

  const cleanBotname =
    String(rawBotname)
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim();

  const namebot = cleanBotname || 'Furina';

  const shortForms = [
    namebot.charAt(0),
    namebot.split(' ')[0],
    String(type).split(' ')[0],
    namebot.split(' ')[0].slice(0, 2),
    namebot.split(' ')[0].slice(0, 3)
  ].filter(Boolean);

  const prefixes = [
    namebot,
    ...shortForms
  ];

  if (Array.isArray(settings?.prefijo)) {
    const list = settings.prefijo
      .map(x => String(x))
      .filter(Boolean);

    if (!list.length) {
      return new RegExp('^', 'i');
    }

    return new RegExp(
      '^(' +
      prefixes.map(escapeRegex).join('|') +
      ')?(' +
      list.map(escapeRegex).join('|') +
      ')',
      'i'
    );
  }

  if (typeof settings?.prefijo === 'string') {
    return new RegExp(
      '^(' +
      prefixes.map(escapeRegex).join('|') +
      ')?(' +
      escapeRegex(settings.prefijo) +
      ')',
      'i'
    );
  }

  if (settings?.prefijo === 1) {
    return /^/i;
  }

  return new RegExp(
    '^(' +
    prefixes.map(escapeRegex).join('|') +
    ')?',
    'i'
  );
}

function findCustomPrefix(text) {
  let customCmd = null;
  let pluginPrefix = null;

  for (const [cmdName, data] of global.comandos.entries()) {

    if (!data?.customPrefix) continue;

    const cp = data.customPrefix;

    let patterns = [];

    if (cp instanceof RegExp) {
      patterns = [cp];

    } else if (Array.isArray(cp)) {
      patterns = cp.map(item =>
        item instanceof RegExp
          ? item
          : new RegExp(escapeRegex(item), 'i')
      );

    } else if (typeof cp === 'string') {
      patterns = [
        new RegExp(escapeRegex(cp), 'i')
      ];
    }

    for (const regex of patterns) {
      if (regex.test(text)) {
        customCmd = cmdName;
        pluginPrefix = regex;
        break;
      }
    }

    if (customCmd) break;
  }

  return {
    customCmd,
    pluginPrefix
  };
}

async function runAllPlugins(context) {

  const plugins = (global.cmdsExecute || [])
    .filter(plugin => plugin?.type === 'all');

  await Promise.allSettled(
    plugins.map(async plugin => {

      try {
        await plugin.fn(context);
      } catch (error) {
        console.error(
          chalk.gray(
            `[ ✿ ] Error in all-plugin ${plugin.key}: ${error.message}`
          )
        );
      }

    })
  );
}


async function runBeforePlugins(context) {

  const plugins = (global.cmdsExecute || [])
    .filter(plugin => plugin?.type === 'before');

  for (const plugin of plugins) {

    try {

      const result = await plugin.fn(context);

      if (result) {
        return true;
      }

    } catch (error) {

      console.error(
        chalk.gray(
          `[ ✿ ] Error in before-plugin ${plugin.key}: ${error.message}`
        )
      );

    }
  }

  return false;
}



async function updateStats(msg) {

  try {

    const chatUser =
      await db.getChatUser(msg.chat, msg.sender);

    if (!chatUser.stats) {
      chatUser.stats = {};
    }

    const today = new Date()
      .toLocaleDateString('ar-EG', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      .split('/')
      .reverse()
      .join('-');

    if (!chatUser.stats[today]) {
      chatUser.stats[today] = {
        msgs: 0,
        cmds: 0
      };
    }

    chatUser.stats[today].msgs++;

    await db.updateChatUser(
      msg.chat,
      msg.sender,
      'stats',
      chatUser.stats
    );

    return {
      chatUser,
      today
    };

  } catch {
    return {
      chatUser: {},
      today: ''
    };
  }
}


function logMessage({
  furina,
  msg,
  command,
  pushname
}) {

  try {

    console.log(`
𝄢 · • —– ٠ ✤ ٠ —– • · · • —– ٠ ✤ ٠ —– • ·✧༄
❚ ▸ ${chalk.cyan('𝐁𝐎𝐓 ❱❱')} ${chalk.bgMagenta(
      chalk.white.italic(
        furina?.user?.name || 'Furina'
      )
    )}
❚ ▸ ${chalk.cyan('𝐓𝐈𝐌𝐄 ❱❱')} ${chalk.black.bgWhite(
      moment().format('DD/MM/YY HH:mm:ss')
    )}
❚ ${chalk.magentaBright('°o.OO.o°°o.OO.o°°o.OO.o°')}
❚ ▸ ${chalk.green('𝐔𝐒𝐄𝐑 ❱❱')} ${chalk.white(
      pushname || 'No name'
    )} / ${chalk.bgMagentaBright.bold(
      msg?.isGroup ? 'Group' : 'Private chat'
    )}
❚ ▸ ${chalk.green('𝐂𝐎𝐌𝐌𝐀𝐍𝐃 ❱❱')} ${chalk.magentaBright(
      command || 'No command'
    )}
❚ ${chalk.magentaBright('°o.OO.o°°o.OO.o°')}
❚ ▸ ${chalk.redBright('𝐓𝐘𝐏𝐄 ❱❱')} ${chalk.greenBright.bold(
      '[Furina Log]'
    )}
𝄢 · • —– ٠ ✤ ٠ —– • · · • —– ٠ ✤ ٠ —– • ·✧༄`.trim());

  } catch {}
}



export default async function handler(furina, msg) {

  try {

    if (!msg) return;


    if (
      msg.fromMe &&
      !msg.key?.participant &&
      msg.isBot
    ) {
      return;
    }

    const sender = getSenderJid(msg);

    const body =
      msg.body ||
      msg.text ||
      '';

    const from =
      msg.key?.remoteJid ||
      msg.chat ||
      '';

    if (!msg.chat) {
      msg.chat = from;
    }


    const botJid = getBotJid(furina);

    if (!botJid) {
      console.error(
        chalk.red('[ ✿ ] I could not determine Furina\'s JID.')
      );
      return;
    }


    let chatData = {};

    try {
      chatData =
        await db.getChat(msg.chat);
    } catch {
      chatData = {};
    }

    let settings = {};

    try {
      settings =
        await db.getSettings(botJid);
    } catch {
      settings = {};
    }


    const ownerJids =
      getOwnerJids();

    const modsJids =
      getModsJids();

    const isOwner =
      ownerJids.includes(sender);

    const isROwner =
      [
        botJid,
        ...(settings?.owner
          ? [settings.owner]
          : []),
        ...ownerJids
      ].includes(sender);

    const {
      groupMetadata,
      participants,
      isAdmins,
      isBotAdmins
    } = await getGroupData(furina, msg);

    await runAllPlugins({
      msg,
      furina,
      groupMetadata,
      participants,
      isAdmins,
      isBotAdmins,
      isOwner,
      isROwner,
      sender,
      __dirname
    });

    const {
      chatUser,
      today
    } = await updateStats(msg);

    const defaultPrefix =
      createPrefix(settings);

    const custom =
      findCustomPrefix(
        msg.text || body || ''
      );

    const pluginPrefix =
      custom.pluginPrefix ||
      defaultPrefix;

    const messageText =
      msg.text ||
      msg.body ||
      '';

    let match = null;

    if (pluginPrefix instanceof RegExp) {

      pluginPrefix.lastIndex = 0;

      const result =
        pluginPrefix.exec(messageText);

      if (result) {
        match = [
          result[0],
          result
        ];
      }

    } else if (Array.isArray(pluginPrefix)) {

      for (const prefix of pluginPrefix) {

        const regex =
          prefix instanceof RegExp
            ? prefix
            : new RegExp(
                escapeRegex(prefix),
                'i'
              );

        const result =
          regex.exec(messageText);

        if (result) {
          match = [
            result[0],
            result
          ];
          break;
        }
      }

    } else if (typeof pluginPrefix === 'string') {

      const regex =
        new RegExp(
          escapeRegex(pluginPrefix),
          'i'
        );

      const result =
        regex.exec(messageText);

      if (result) {
        match = [
          result[0],
          result
        ];
      }
    }

    const beforeStopped =
      await runBeforePlugins({
        msg,
        furina,
        match,
        groupMetadata,
        participants,
        isAdmins,
        isBotAdmins,
        isOwner,
        isROwner,
        sender,
        __dirname
      });

    if (beforeStopped) {
      return;
    }

    if (!match) {
      return;
    }
    const usedPrefix =
      match[0] || '';

    const commandText =
      messageText
        .slice(usedPrefix.length)
        .trim();

    if (!commandText) {
      return;
    }

    let args =
      commandText
        .split(/\s+/);

    let command =
      custom.customCmd ||
      (args.shift() || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const text =
      args.join(' ');

    if (!command) {
      return;
    }

    const primaryBot =
      chatData?.primaryBot;

    if (
      msg.message ||
      !primaryBot ||
      primaryBot === botJid
    ) {

      logMessage({
        furina,
        msg,
        command,
        pushname:
          msg.pushName ||
          'No name'
      });

    }

    if (settings?.self) {

      const settingOwner =
        settings.owner;

      if (
        sender !== settingOwner &&
        !isOwner &&
        !modsJids.includes(sender) &&
        sender !== botJid
      ) {
        return;
      }
    }

    if (
      msg.chat &&
      !msg.chat.endsWith('@g.us')
    ) {

      const allowedPrivate =
        [
          
          'report',
          'reporte',
          'sug',
          'suggest',
          'invite',
          'invitar',
          'setusername',
          'setpfp',
          'setimage',
          'setstatus',
          'reload',
          'setname',
          'setbotname',
          'setmenubanner',
          'setbanner',
          'setbotcurrency',
          'setbotowner',
          'setlink',
          'setbotlink',
          'setbotprefix',
          'seticon'
        ];

      const settingOwner =
        settings?.owner;

      if (
        sender !== settingOwner &&
        !isOwner &&
        !allowedPrivate.includes(command)
      ) {
        return;
      }
    }


    const bannedCommands = [
      '#bot on',
      '/bot on',
      '.bot on',
      '!bot on',
      '-bot on',
      '+bot on',
      'bot on'
    ];

    if (
      chatData?.bannedGrupo &&
      !bannedCommands.includes(
        body.toLowerCase()
      ) &&
      !isOwner
    ) {
      return;
    }

    if (
      chatData?.adminonly &&
      !isAdmins
    ) {
      return;
    }

    if (
      msg.id?.startsWith('3EB0') ||
      (
        msg.id?.startsWith('BAE5') &&
        msg.id?.length === 16
      ) ||
      (
        msg.id?.startsWith('B24E') &&
        msg.id?.length === 20
      )
    ) {
      return;
    }


    if (!(global.comandos instanceof Map)) {
      global.comandos = new Map();
    }

    const cmdData =
      global.comandos.get(command);

    if (!cmdData) {

      if (settings?.prefijo === 1) {
        return;
      }

      try {
        await furina.readMessages([
          msg.key
        ]);
      } catch {}

      if (typeof msg.reply === 'function') {

        return msg.reply(
          `⌁ هـاذا الأمـر *${command}* غـيـر مـوجـود
 اكـتـبـي .اوامـر لـعـرض الأوامـر الـمـتـاحـه.  › ◡ ‹`
        );
      }

      return;
    }


    if (
      cmdData.isOwner &&
      !isOwner &&
      sender !== botJid
    ) {

      return msg.reply(
        `الامـر ده لـلـمـطـوره بـس ( › ◡ ‹ ).`
      );
    }

    if (
      cmdData.isAdmin &&
      !isAdmins
    ) {

      if (typeof msg.reply === 'function') {

        return msg.reply(
          '⌁ الامـر ده لـلادمــن بـس ( › ◡ ‹ )'
        );

      }

      return;
    }


    if (
      cmdData.botAdmin &&
      !isBotAdmins
    ) {

      if (typeof msg.reply === 'function') {

        return msg.reply(
          '⌁ لـازم اكــون ادمــن يـاروحـي!!'
        );

      }

      return;
    }


    try {

      try {
        await furina.sendPresenceUpdate(
          'composing',
          msg.chat
        );
      } catch {}

      try {
        await furina.readMessages([
          msg.key
        ]);
      } catch {}

    
      let user2 = {};

      try {
        user2 =
          await db.getUser(msg.sender);
      } catch {
        user2 = {};
      }

      user2.usedcommands =
        (user2.usedcommands || 0) + 1;

      settings.commandsejecut =
        (settings.commandsejecut || 0) + 1;

      const usedTime =
        new Date();

      user2.exp =
        (user2.exp || 0) +
        Math.floor(
          Math.random() * 100
        );

      user2.name =
        msg.pushName ||
        'No name';

      try {
        await db.updateChatUser(
          msg.chat,
          msg.sender,
          'usedTime',
          usedTime
        );
      } catch {}

      try {
        await db.updateUser(
          msg.sender,
          'exp',
          user2.exp
        );

        await db.updateUser(
          msg.sender,
          'name',
          user2.name
        );

        await db.updateUser(
          msg.sender,
          'usedcommands',
          user2.usedcommands
        );
      } catch {}

      try {
        await db.updateSettings(
          botJid,
          'commandsejecut',
          settings.commandsejecut
        );
      } catch {}

     
      if (
        chatUser &&
        today
      ) {

        if (!chatUser.stats) {
          chatUser.stats = {};
        }

        if (!chatUser.stats[today]) {
          chatUser.stats[today] = {
            msgs: 0,
            cmds: 0
          };
        }

        chatUser.stats[today].cmds++;

        try {
          await db.updateChatUser(
            msg.chat,
            msg.sender,
            'stats',
            chatUser.stats
          );
        } catch {}
      }

    
      const plugin =
        global.plugins?.[
          cmdData.pluginKey
        ];

      await cmdData.run({

        furina,

        msg,

        args,

        command,

        usedPrefix,

        text,

        sender,

        isOwner,

        isROwner,

        isGroup:
          Boolean(msg.isGroup),

        isAdmin:
          isAdmins,

        isBotAdmin:
          isBotAdmins,

        groupMetadata,

        participants,

        __dirname,

        chatData,

        settings,

        plugin

      });

    } catch (error) {

      console.error(
        chalk.red(
          `[ ✿ ] Error in command ${command}:`
        )
      );

      console.error(error);

      try {

        if (typeof msg.reply === 'function') {

          await msg.reply(
            `✿ An error occurred while executing the command:\n\n` +
            `${error?.message || error}`
          );

        }

      } catch {}

    }

  } catch (error) {

    console.error(
      chalk.red(
        '[ ✿ ] Error in Furina Handler:'
      )
    );

    console.error(error);

  }

}
