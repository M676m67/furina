import cp from 'child_process'
import { promisify } from 'util'
const exec = promisify(cp.exec)
export default {
  command: ['r'],
  isOwner: false,
  run: async ({ msg, furina, args }) => {
    const cmd = args.join(' ').trim()
    if (!cmd) {
      return
    }
    let result
    try {
      result = await exec(cmd)
    } catch (e) {
      result = e
    }
    const { stdout, stderr } = result
    if (stdout?.trim()) {
      furina.reply(msg.chat, stdout.trim(), msg)
    }
    if (stderr?.trim()) {
      furina.reply(msg.chat, stderr.trim(), msg)
    }
  }
}
