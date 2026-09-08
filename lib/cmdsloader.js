import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const commandsFolder = path.resolve(
  __dirname,
  '../cmds'
);

const pluginCache = new Map();
const debounceMap = new Map();
const watchers = new Map();



if (!(global.comandos instanceof Map)) {
  global.comandos = new Map();
}

if (!global.plugins || typeof global.plugins !== 'object') {
  global.plugins = {};
}

if (!Array.isArray(global.cmdsExecute)) {
  global.cmdsExecute = [];
}



function getPluginKey(filePath) {
  return path
    .relative(commandsFolder, filePath)
    .replace(/\\/g, '/')
    .replace(/\.js$/i, '');
}



function unregisterModule(filePath) {

  const key =
    getPluginKey(filePath);

  for (const [command, data] of global.comandos.entries()) {

    if (data?.pluginKey === key) {
      global.comandos.delete(command);
    }

  }

  global.cmdsExecute =
    global.cmdsExecute.filter(
      plugin => plugin?.key !== key
    );

  delete global.plugins[key];
}


function registerModule(filePath, mod) {

  const key =
    getPluginKey(filePath);


  unregisterModule(filePath);

  const plugin =
    mod?.default;

  if (!plugin) {
    console.error(
      chalk.red(
        `[ Furina ] ${path.basename(filePath)} لا يحتوي على export default`
      )
    );

    return;
  }

  const dirname =
    path.dirname(filePath);


  global.plugins[key] = {
    ...mod,
    ...plugin,
    dirname,
    filepath: filePath
  };


  const allFn =
    typeof plugin.all === 'function'
      ? plugin.all
      : typeof mod.all === 'function'
        ? mod.all
        : null;

  if (allFn) {

    global.cmdsExecute.push({
      key,
      type: 'all',
      fn: allFn,
      dirname
    });

  }


  const beforeFn =
    typeof plugin.before === 'function'
      ? plugin.before
      : typeof mod.before === 'function'
        ? mod.before
        : null;

  if (beforeFn) {

    global.cmdsExecute.push({
      key,
      type: 'before',
      fn: beforeFn,
      dirname
    });

  }


  if (typeof plugin.run !== 'function') {

    console.log(
      chalk.gray(
        `[ Furina ] تم تحميل ${path.basename(filePath)} بدون command`
      )
    );

    return;
  }


  
  let commands =
    plugin.command;


  if (typeof commands === 'string') {
    commands = [commands];
  }

  if (!Array.isArray(commands)) {
    commands = [];
  }


  commands =
    commands
      .filter(Boolean)
      .map(command =>
        String(command)
          .trim()
          .toLowerCase()
      );


  for (const command of commands) {

    if (!command) {
      continue;
    }

    global.comandos.set(
      command,
      {
        pluginKey: key,

        run: plugin.run,

        category:
          plugin.category ||
          'general',

        description:
          plugin.description ||
          '',

        isOwner:
          Boolean(plugin.isOwner),

        isAdmin:
          Boolean(plugin.isAdmin),

        botAdmin:
          Boolean(plugin.botAdmin),

        customPrefix:
          plugin.customPrefix ??
          null,

        filename:
          path.basename(filePath),

        dirname
      }
    );

  }


  if (!commands.length) {

    console.log(
      chalk.gray(
        `[ Furina ] Plugin: ${path.basename(filePath)} · بدون أمر`
      )
    );

  }

}



async function importModule(filePath) {

  if (!fs.existsSync(filePath)) {
    throw new Error('الملف غير موجود');
  }

  const mtime =
    fs.statSync(filePath).mtimeMs;

  const cached =
    pluginCache.get(filePath);

  if (
    cached &&
    cached.mtime === mtime
  ) {
    return cached.mod;
  }


  const url =
    `${pathToFileURL(filePath).href}?furina=${mtime}`;


  const mod =
    await import(url);


  pluginCache.set(
    filePath,
    {
      mtime,
      mod
    }
  );


  return mod;
}



function collectFiles(
  directory,
  files = []
) {

  let entries;

  try {

    entries =
      fs.readdirSync(
        directory,
        {
          withFileTypes: true
        }
      );

  } catch {

    return files;

  }


  for (const entry of entries) {

    const fullPath =
      path.join(
        directory,
        entry.name
      );


    if (entry.isDirectory()) {

      collectFiles(
        fullPath,
        files
      );

      continue;

    }


    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.js')
    ) {

      files.push(fullPath);

    }

  }


  return files;

}

async function scan(directory) {

  const files =
    collectFiles(directory);

  let errors = 0;

  for (const filePath of files) {

    try {

      const mod =
        await importModule(filePath);

      registerModule(
        filePath,
        mod
      );

    } catch (error) {

      errors++;

      console.error(
        chalk.red(
          `[ Furina ] خطأ في تحميل ${path.basename(filePath)}:`
        )
      );

      console.error(
        chalk.gray(
          error?.stack ||
          error?.message ||
          error
        )
      );

    }

  }


  return {
    total: files.length,
    errors
  };

}


async function reloadFile(filePath) {

  if (
    !filePath ||
    !filePath.toLowerCase().endsWith('.js')
  ) {
    return;
  }


  const key =
    getPluginKey(filePath);



  if (!fs.existsSync(filePath)) {

    pluginCache.delete(filePath);

    unregisterModule(filePath);

    console.log(
      chalk.gray(
        `[ Furina ] تم حذف Plugin: ${path.basename(filePath)}`
      )
    );

    return;
  }


  try {

    const mtime =
      fs.statSync(filePath).mtimeMs;

    const cached =
      pluginCache.get(filePath);


    if (
      cached &&
      cached.mtime === mtime
    ) {
      return;
    }


   
    pluginCache.delete(filePath);


    const mod =
      await importModule(filePath);


    registerModule(
      filePath,
      mod
    );


    console.log(
      chalk.green(
        `[ Furina ] ✓ تم تحديث: ${path.basename(filePath)}`
      )
    );


  } catch (error) {

    console.error(
      chalk.red(
        `[ Furina ] ✗ فشل تحديث ${path.basename(filePath)}`
      )
    );

    console.error(
      chalk.gray(
        error?.stack ||
        error?.message ||
        error
      )
    );

  }

}


global.reload = (
  _,
  filePath
) => {

  if (
    !filePath ||
    !filePath.toLowerCase().endsWith('.js')
  ) {
    return;
  }


  const oldTimer =
    debounceMap.get(filePath);


  if (oldTimer) {
    clearTimeout(oldTimer);
  }


  const timer =
    setTimeout(
      async () => {

        debounceMap.delete(
          filePath
        );

        await reloadFile(
          filePath
        );

      },
      300
    );


  debounceMap.set(
    filePath,
    timer
  );

};



function watchDir(directory) {

  if (
    watchers.has(directory)
  ) {
    return;
  }

  if (
    !fs.existsSync(directory)
  ) {
    return;
  }


  try {

    const watcher =
      fs.watch(
        directory,
        {
          persistent: true
        },
        (_, filename) => {

          if (!filename) {
            return;
          }


          const name =
            filename.toString();


          if (
            !name.toLowerCase().endsWith('.js')
          ) {
            return;
          }


          const filePath =
            path.join(
              directory,
              name
            );


          global.reload(
            _,
            filePath
          );

        }
      );


    watchers.set(
      directory,
      watcher
    );


  } catch (error) {

    console.error(
      chalk.red(
        `[ Furina ] تعذر مراقبة ${directory}: ${error.message}`
      )
    );

  }


  let entries;

  try {

    entries =
      fs.readdirSync(
        directory,
        {
          withFileTypes: true
        }
      );

  } catch {

    return;

  }


  for (const entry of entries) {

    if (entry.isDirectory()) {

      watchDir(
        path.join(
          directory,
          entry.name
        )
      );

    }

  }

}



export default async function cmdsLoader() {

  const start =
    Date.now();


 

  if (!(global.comandos instanceof Map)) {
    global.comandos = new Map();
  }




  if (!Array.isArray(global.cmdsExecute)) {
    global.cmdsExecute = [];
  }


  const {
    total,
    errors
  } =
    await scan(
      commandsFolder
    );


  watchDir(
    commandsFolder
  );


  const time =
    Date.now() - start;


  console.log(
    chalk.gray(
      `[ Furina ] تم تحميل ${global.comandos.size} أمر من ${total} Plugin في ${time}ms${
        errors
          ? ` · ${errors} أخطاء`
          : ''
      }`
    )
  );

}
