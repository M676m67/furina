import syntaxerror from 'syntax-error'
import { format } from 'util'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(__dirname)

export default {
  command: ['e', 'er'],
  isOwner: false,
  run: async ({ msg, furina, text, command }) => {
    let code = text.trim()

    if (command === 'er') {
      code = `return (${code})`
    }

    let result
    let syntax = ''

    try {
      const module = { exports: {} }

      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor

      const exec = new AsyncFunction(
        'furina',
        'msg',
        'require',
        'module',
        'exports',
        code
      )

      result = await exec(
        furina,
        msg,
        require,
        module,
        module.exports
      )

    } catch (e) {
      const err = syntaxerror(code, 'Eval Error', {
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
        sourceType: 'module'
      })

      if (err) syntax = '```' + err + '```\n\n'
      result = e
    }

    return furina.reply(
      msg.chat,
      format(result),
      msg
    )
  }
}
