import fs from 'fs';
import { watchFile, unwatchFile } from 'fs';
import { fileURLToPath } from 'url';

global.owner = ['201015709086'];

global.api = {
  url: 'https://api.stellarwa.xyz',
  key: 'proyectsV2'
};

global.msgglobal = '✿⸝꙳.˖ حدثت مشكلة، يرجى التواصل مع المطور';
global.dev = `★彡[xɪ_ᴍɪɢᴜᴇʟᴏɴ77xx]彡★`;

global.mess = {
  admin: '٩ʕ◕౪◕ʔو هذا الأمر يمكن تنفيذه فقط بواسطة مشرفي المجموعة.',
  botAdmin: '(𓂂꜆◕⩊◕꜀𓂂) هذا الأمر يمكن تنفيذه فقط إذا كان Furina مشرفًا في المجموعة.',
  comandooff: 'ღゝ◡╹ )ノ هذه الأوامر معطلة في هذه المجموعة.'
};

global.my = {
  ch: "120363407128588763@newsletter"
};

let file = fileURLToPath(import.meta.url);

watchFile(file, () => {
  unwatchFile(file);
  import(`${file}?update=${Date.now()}`);
});
