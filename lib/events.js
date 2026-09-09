import db from '#db';
import chalk from 'chalk';
import moment from 'moment-timezone';

function getGroupAdmins(participants = []) {
  return participants
    .filter(
      p =>
        p.admin === 'admin' ||
        p.admin === 'superadmin'
    )
    .map(p => p.id || p.jid || p.lid)
    .filter(Boolean);
}

function normalizeJid(jid = '') {
  if (!jid) return '';

  if (typeof jid !== 'string') {
    jid =
      jid.id ||
      jid.jid ||
      jid.phoneNumber ||
      jid.lid ||
      '';
  }

  if (!jid) return '';

  if (jid.includes('@')) {
    return jid;
  }

  return `${jid}@s.whatsapp.net`;
}

function resolveParticipantJid(participant, furina) {
  if (typeof participant === 'string') {
    return normalizeJid(participant);
  }

  if (!participant) return '';

  return normalizeJid(
    participant.id ||
    participant.jid ||
    participant.phoneNumber ||
    participant.lid ||
    ''
  );
}

function getBotJid(furina) {
  const id = furina?.user?.id;

  if (!id) return '';

  return id.includes(':')
    ? `${id.split(':')[0]}@s.whatsapp.net`
    : normalizeJid(id);
}

export default function events(furina) {
  if (!furina?.ev) {
    console.log(
      chalk.red('[ EVENTS ] Furina socket غير موجود.')
    );
    return;
  }

  furina.ev.on(
    'group-participants.update',
    async update => {
      try {
        const {
          id,
          participants = [],
          action,
          author
        } = update;

        if (!id) return;

        if (
          ![
            'add',
            'remove',
            'leave',
            'promote',
            'demote'
          ].includes(action)
        ) {
          return;
        }

        let metadata = null;

        try {
          metadata = await furina.groupMetadata(id);
        } catch {
          return;
        }

        if (!metadata) return;

        const groupAdmins = getGroupAdmins(
          metadata.participants
        );

        const botJid = getBotJid(furina);

        const chat = await db.getChat(id);
        const botSettings = await db.getSettings(
          botJid
        );

        const primaryBotId =
          chat?.primaryBot || null;

        const isSelf =
          botSettings?.self === 1 ||
          chat?.isMute === true;

        if (isSelf) return;

        if (
          primaryBotId &&
          primaryBotId !== botJid
        ) {
          return;
        }

        const memberCount =
          metadata.participants?.length || 0;

        const now = moment.tz(
          'America/Bogota'
        );

        const date = now.format(
          'DD MMM YYYY'
        );

        const time = now.format(
          'hh:mm A'
        );

        for (const participant of participants) {
          const jid =
            resolveParticipantJid(
              participant,
              furina
            );

          if (!jid) continue;

          const phone =
            jid.split('@')[0];

          const user =
            await db.getUser(jid);

          const name =
            user?.name ||
            phone;

          const avatar =
            await furina
              .profilePictureUrl(
                jid,
                'image'
              )
              .catch(
                () =>
                  'https://cloud.stellarwa.xyz/i6AeOyYU.jpeg'
              );

          const mentions = [jid];


          if (
            action === 'add' &&
            chat?.welcome
          ) {
            let caption;

            if (
              chat.welcomeMessage &&
              chat.welcomeMessage.trim()
            ) {
              caption =
                chat.welcomeMessage
                  .replace(
                    /@user/g,
                    `@${phone}`
                  )
                  .replace(
                    /@group/g,
                    metadata.subject || ''
                  )
                  .replace(
                    /@desc/g,
                    metadata.desc ||
                      'لا يوجد وصف'
                  )
                  .replace(
                    /@members/g,
                    String(memberCount)
                  )
                  .replace(
                    /@time/g,
                    `${date} ${time}`
                  );
            } else {
              caption = `⊹₊˚‧︵‿₊୨ᰔ୧₊‿︵‧˚₊⊹
│⤣ ۬♡ـ مـنــوـره ${phone} 💐💞˖ 
│⤣ ۬♡ـ عـدد الاعـضـاء: ${memberCount} 🎀˖ 
⊹₊˚‧︵‿₊୨ᰔ୧₊‿︵‧˚₊⊹

> 𝙱𝚈: 𝙵𝚄𝚁𝙸𝙽𝙰⋆.𐙚 ̊`;
            }

            await furina.sendMessage(
              id,
              {
                text: caption.trim(),
                mentions
              }
            );
          }

   

          if (
            (
              action === 'remove' ||
              action === 'leave'
            ) &&
            chat?.goodbye
          ) {
            let caption;

            if (
              chat.byeMessage &&
              chat.byeMessage.trim()
            ) {
              caption =
                chat.byeMessage
                  .replace(
                    /@user/g,
                    `@${phone}`
                  )
                  .replace(
                    /@group/g,
                    metadata.subject || ''
                  )
                  .replace(
                    /@desc/g,
                    metadata.desc ||
                      'لا يوجد وصف'
                  )
                  .replace(
                    /@members/g,
                    String(memberCount)
                  )
                  .replace(
                    /@time/g,
                    `${date} ${time}`
                  );
            } else {
              caption = `⊹₊˚‧︵‿₊୨ᰔ୧₊‿︵‧˚₊⊹
│⤣ ۬♡ـ مـع الـسلاـمـة ${phone} 💐💞˖ 
│⤣ ۬♡ـ عـدد الاعـضـاء: ${memberCount} 🎀˖ 
⊹₊˚‧︵‿₊୨ᰔ୧₊‿︵‧˚₊⊹

> 𝙱𝚈: 𝙵𝚄𝚁𝙸𝙽𝙰⋆.𐙚 ̊`;
            }

            await furina.sendMessage(
              id,
              {
                text: caption.trim(),
                mentions
              }
            );
          }

         

          if (
            action === 'promote' &&
            chat?.alerts
          ) {
            const authorJid =
              normalizeJid(author);

            const authorPhone =
              authorJid
                ? authorJid.split('@')[0]
                : 'غير معروف';

            await furina.sendMessage(
              id,
              {
                text:
`「✎」 @${phone} تم ترقيته إلى مشرف بواسطة @${authorPhone}.`,
                mentions: [
                  jid,
                  ...(authorJid
                    ? [authorJid]
                    : [])
                ]
              }
            );
          }

        

          if (
            action === 'demote' &&
            chat?.alerts
          ) {
            const authorJid =
              normalizeJid(author);

            const authorPhone =
              authorJid
                ? authorJid.split('@')[0]
                : 'غير معروف';

            await furina.sendMessage(
              id,
              {
                text:
`「✎」 @${phone} تمت إزالة صلاحية الإشراف عنه بواسطة @${authorPhone}.`,
                mentions: [
                  jid,
                  ...(authorJid
                    ? [authorJid]
                    : [])
                ]
              }
            );
          }
        }
      } catch (error) {
        console.log(
          chalk.gray(
            `[ EVENTS ERROR ] → ${error}`
          )
        );
      }
    }
  );

  console.log(
    chalk.green(
      '[ EVENTS ] تم تشغيل أحداث Furina بنجاح.'
    )
  );
}
