

import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

function getQuotedCode(msg) {
  const quoted = msg.quoted

  if (quoted?.text && typeof quoted.text === 'string') {
    return quoted.text
  }

  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.msg?.contextInfo

  const quotedMessage = context?.quotedMessage

  if (!quotedMessage) return ''

  if (quotedMessage.conversation) {
    return quotedMessage.conversation
  }

  if (quotedMessage.extendedTextMessage?.text) {
    return quotedMessage.extendedTextMessage.text
  }

  if (quotedMessage.imageMessage?.caption) {
    return quotedMessage.imageMessage.caption
  }

  if (quotedMessage.videoMessage?.caption) {
    return quotedMessage.videoMessage.caption
  }

  return ''
}

function cleanCode(code) {
  code = String(code || '').trim()

  if (code.startsWith('```') && code.endsWith('```')) {
    code = code.replace(/^```(?:js|javascript)?\s*/i, '')
    code = code.replace(/\s*```$/i, '')
  }

  return code.trim()
}

function getSyntaxError(stderr) {
  const match =
    stderr.match(/\.js:(\d+):(\d+)/) ||
    stderr.match(/:(\d+):(\d+)/)

  if (!match) {
    return {
      line: 'غير معروف',
      column: 'غير معروف'
    }
  }

  return {
    line: match[1],
    column: match[2]
  }
}

export default {
  command: ['ضعه', 'ph'],
  category: 'owner',
  isOwner: false ,

  run: async ({ msg, furina, args }) => {
    try {
      if (!args[0]) {
        return msg.reply(
          '✰🧁│ ضعي اسم الملف\nمثال: .ph owner/test'
        )
      }

      let quotedText = getQuotedCode(msg)

      if (!quotedText) {
        return msg.reply(
          'اعـمـلـي ربـلاي ع الـكـود الـي عـايـزه تـضـيـفـيـه'
        )
      }

      quotedText = cleanCode(quotedText)

      if (!quotedText) {
        return msg.reply(
          ' مـا قـدرت اسـتـخـرج الـكـود مـن الـربـلاي'
        )
      }

      let file = args[0]

      if (!file.endsWith('.js')) {
        file += '.js'
      }

      const filePath = path.join('cmds', file)
      const folder = path.dirname(filePath)

      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true })
      }

      const tempFile = path.join(
        folder,
        `.check_${Date.now()}_${path.basename(file)}`
      )

      fs.writeFileSync(
        tempFile,
        quotedText,
        'utf8'
      )

      try {
        await execFileAsync(
          process.execPath,
          ['--check', tempFile]
        )
      } catch (error) {
        try {
          fs.unlinkSync(tempFile)
        } catch {}

        const stderr =
          error.stderr ||
          error.stdout ||
          error.message ||
          ''

        const { line, column } =
          getSyntaxError(stderr)

        return msg.reply(
          `*^᪲᪲⌯ Error in the code Syntax.!!*
*^᪲᪲⌯line :* ${line}
*^᪲᪲⌯columm:* ${column}

${stderr}`
        )
      }

      try {
        fs.unlinkSync(tempFile)
      } catch {}

      fs.writeFileSync(
        filePath,
        quotedText,
        'utf8'
      )

      const fake = {
        key: {
          participants: '0@s.whatsapp.net',
          remoteJid: 'status@broadcast',
          fromMe: false,
          id: 'Halo'
        },
        message: {
          contactMessage: {
            vcard: `BEGIN:VCARD
VERSION:3.0
N:Bot;;;;
FN:Bot
item1.TEL;waid=${msg.sender.split('@')[0]}:${msg.sender.split('@')[0]}
item1.X-ABLabel:Ponsel
END:VCARD`
          }
        },
        participant: '0@s.whatsapp.net'
      }

      await furina.sendMessage(
        msg.chat,
        {
          text: `⌯ تـم فـحـص الـكـود وحـفـظـه بـنـجـاح:
${filePath}`
        },
        {
          quoted: fake
        }
      )

    } catch (e) {
      try {
        if (typeof tempFile !== 'undefined' && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch {}

      await msg.reply(
        `${e.message}`
      )
    }
  }
          }
