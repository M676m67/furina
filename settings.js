
import fs from 'fs';
import { watchFile, unwatchFile } from 'fs';
import { fileURLToPath } from 'url';

global.owner = ['201015709086'];

global.api = {
  url: 'https://api.stellarwa.xyz',
  key: 'proyectsV2'
};

global.msgglobal = 'Error in Forina Bot ( › ◡ ‹ )';
global.dev = `𝙱𝚈: 𝙺𝙰𝙽𝙰𝙾^᪲᪲`;

global.mess = {
  admin: '⌁ الامـر ده لـلادمــن ببس › ◡ ‹ ',
  botAdmin: '.',
  comandooff: '⌁ الامـر ده مـش شـغـال هـنـا يـاروحـي › ◡ ‹ '
};

global.my = {
  ch: "120363399248151446@newsletter"
};

let file = fileURLToPath(import.meta.url);

watchFile(file, () => {
  unwatchFile(file);
  import(`${file}?update=${Date.now()}`);
});
