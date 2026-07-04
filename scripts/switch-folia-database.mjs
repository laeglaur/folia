import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const databaseFiles = ['notebook.sqlite3', 'notebook.sqlite3-wal', 'notebook.sqlite3-shm'];
const appDataDir = process.env.FOLIA_DATA_DIR
  ?? path.join(homedir(), 'Library/Application Support/com.laeglaur.notebook');
const profilesDir = path.join(appDataDir, 'database-profiles');
const activeProfileFile = path.join(profilesDir, '.active-profile');

const usage = `Usage:
  pnpm folia-db status
  pnpm folia-db use-demo
  pnpm folia-db use-real

Environment:
  FOLIA_DATA_DIR=/custom/path        Override the folia app data directory.
  FOLIA_DB_SWITCH_ALLOW_RUNNING=1    Skip the running-app safety check.
`;

const timestamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

const activePath = (filename) => path.join(appDataDir, filename);
const profilePath = (profile) => path.join(profilesDir, profile);
const profileFilePath = (profile, filename) => path.join(profilePath(profile), filename);

const fileExists = (filename) => existsSync(activePath(filename));
const profileFileExists = (profile, filename) => existsSync(profileFilePath(profile, filename));

const readActiveProfile = async () => {
  if (!existsSync(activeProfileFile)) return 'real';
  const value = (await readFile(activeProfileFile, 'utf8')).trim();
  return value === 'demo' ? 'demo' : 'real';
};

const writeActiveProfile = async (profile) => {
  await mkdir(profilesDir, { recursive: true });
  await writeFile(activeProfileFile, `${profile}\n`);
};

const isDirectoryNonEmpty = async (directory) => {
  if (!existsSync(directory)) return false;
  const entries = await readdir(directory);
  return entries.length > 0;
};

const profileHasDatabaseFiles = (profile) =>
  databaseFiles.some((filename) => profileFileExists(profile, filename));

const activeHasDatabaseFiles = () =>
  databaseFiles.some((filename) => fileExists(filename));

const moveFile = async (source, target) => {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await copyFile(source, target);
    await unlink(source);
  }
};

const assertFoliaNotRunning = () => {
  if (process.env.FOLIA_DB_SWITCH_ALLOW_RUNNING === '1') return;
  if (process.platform !== 'darwin') return;

  const processNames = ['folia', 'block_first_notebook'];
  const running = processNames.filter((name) => {
    try {
      execFileSync('pgrep', ['-x', name], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });

  if (running.length) {
    throw new Error(`folia appears to be running (${running.join(', ')}). Quit folia before switching databases.`);
  }
};

const backupProfileIfNeeded = async (profile) => {
  const directory = profilePath(profile);
  if (!(await isDirectoryNonEmpty(directory))) return null;
  const backupDirectory = profilePath(`${profile}.backup.${timestamp()}`);
  await rename(directory, backupDirectory);
  return backupDirectory;
};

const saveActiveAsProfile = async (profile) => {
  const backupDirectory = await backupProfileIfNeeded(profile);
  const directory = profilePath(profile);
  await mkdir(directory, { recursive: true });

  const moved = [];
  for (const filename of databaseFiles) {
    const source = activePath(filename);
    if (!existsSync(source)) continue;
    await moveFile(source, profileFilePath(profile, filename));
    moved.push(filename);
  }

  if (backupDirectory) {
    console.log(`Archived previous ${profile} profile: ${backupDirectory}`);
  }
  if (moved.length) {
    console.log(`Saved active database as ${profile}: ${moved.join(', ')}`);
  } else {
    console.log(`No active database files to save as ${profile}.`);
  }
};

const restoreProfileToActive = async (profile, { required = false } = {}) => {
  if (activeHasDatabaseFiles()) {
    throw new Error('Active database files still exist. Refusing to overwrite them.');
  }
  if (!profileHasDatabaseFiles(profile)) {
    if (required) throw new Error(`No saved ${profile} profile found.`);
    console.log(`No saved ${profile} profile found. folia will create a fresh database on next launch.`);
    return;
  }

  const moved = [];
  for (const filename of databaseFiles) {
    const source = profileFilePath(profile, filename);
    if (!existsSync(source)) continue;
    await moveFile(source, activePath(filename));
    moved.push(filename);
  }
  await rm(profilePath(profile), { recursive: true, force: true });
  console.log(`Restored ${profile} profile to active database: ${moved.join(', ')}`);
};

const printStatus = async () => {
  const activeProfile = await readActiveProfile();
  console.log(`Data directory: ${appDataDir}`);
  console.log(`Active profile marker: ${activeProfile}`);
  console.log('');
  console.log('Active database files:');
  for (const filename of databaseFiles) {
    console.log(`  ${existsSync(activePath(filename)) ? 'yes' : ' no'}  ${filename}`);
  }
  console.log('');
  console.log('Saved profiles:');
  for (const profile of ['real', 'demo']) {
    const files = databaseFiles.filter((filename) => profileFileExists(profile, filename));
    console.log(`  ${profile}: ${files.length ? files.join(', ') : '(empty)'}`);
  }
};

const useDemo = async () => {
  assertFoliaNotRunning();
  const activeProfile = await readActiveProfile();
  if (activeProfile === 'demo') {
    console.log('Already using demo database.');
    await printStatus();
    return;
  }

  await saveActiveAsProfile('real');
  await restoreProfileToActive('demo');
  await writeActiveProfile('demo');
  console.log('Now using demo database.');
};

const useReal = async () => {
  assertFoliaNotRunning();
  const activeProfile = await readActiveProfile();
  if (activeProfile === 'real') {
    console.log('Already using real database.');
    await printStatus();
    return;
  }

  await saveActiveAsProfile('demo');
  await restoreProfileToActive('real', { required: true });
  await writeActiveProfile('real');
  console.log('Now using real database.');
};

const main = async () => {
  const command = process.argv[2];
  if (!command || command === '-h' || command === '--help') {
    console.log(usage);
    return;
  }

  if (command === 'status') {
    await printStatus();
    return;
  }

  await mkdir(appDataDir, { recursive: true });
  await mkdir(profilesDir, { recursive: true });

  if (command === 'use-demo') {
    await useDemo();
    return;
  }
  if (command === 'use-real') {
    await useReal();
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
