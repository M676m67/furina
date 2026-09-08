import db from "#db"
export default {
  command: ['ping', 'p', 'بينج'],
  category: 'info',
  run: async ({ msg, furina }) => {
    const start = Date.now()
    const sent = await furina.sendMessage(msg.chat, { text: '`❏ ¡Pong!`' + `\n> *${await db.getSettings(furina.user.id.split(':')[0] + "@s.whatsapp.net").namebot}*`}, { quoted: msg })
    const latency = Date.now() - start

    await furina.sendMessage(msg.chat, {
      text: `✿ *Pong!*\n> Tiempo ⴵ ${latency}ms`,
      edit: sent.key
    }, { quoted: msg })
  },
};
