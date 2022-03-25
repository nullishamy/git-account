import execa from 'execa';
import fs from 'fs';
import ini from 'ini';
import {homedir} from 'os';
import path from 'path';
import {promisify} from 'util';
import {User} from './config';

export type ConfigScope = 'global' | 'local';

export interface ConfigPath {
  global: string;
  local: string;
}

export interface GitConfigParams {
  'user.name': string;
  'user.email': string;
  'core.sshCommand': string;
  'user.signingKey': string;
  [index: string]: string;
}

export interface Remote {
  url: string;
  fetch: string;
  gtPrivateKeyPath?: string;
}

export interface GitConfig {
  'remote "origin"'?: Remote;
  user: {
    name: string;
    email: string;
    signingKey: string;
  };
}

const CONFIG_PATH: ConfigPath = {
  global: path.resolve(homedir(), '.gitconfig'),
  local: path.resolve('.git', 'config'),
};

function clean<T>(arg: T): arg is Exclude<T, null> {
  return arg !== null;
}

export async function switchAccount(user: User): Promise<GitConfigParams> {
  const localConfig = await getLocalConfig();
  const remotes = Object.keys(localConfig)
    .map((k) => /^remote "(.+?)"$/.exec(k))
    .filter(clean)
    .map((r) => r[1]);
  const entries: GitConfigParams = {
    'user.name': user.name,
    'user.email': user.email,
    'core.sshCommand': `ssh -i ${user.privateKey} -oIdentitiesOnly=yes`,
    ...Object.fromEntries(
      remotes.map((key) => [`remote.${key}.gtPrivateKeyPath`, user.privateKey]),
    ),
    'user.signingKey': user.gpgKey
  };
  try {
    setLocalConfig(entries);
    return entries;
  } catch (err) {
    throw new Error(err.message);
  }
}

export async function runCommand(
  command: Array<string>,
  execaOptions: execa.Options = {},
) {
  try {
    const config = await getCombinedConfig();
    const {gtPrivateKeyPath} = config[`remote "origin"`]!;
    const {name, email} = config.user;
    const env = {
      GIT_SSH_COMMAND: `ssh -i ${gtPrivateKeyPath} -oIdentitiesOnly=yes`,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
    };
    const result = await execa(command.join(' '), {env, ...execaOptions});
    return result.stdout;
  } catch (err) {
    throw new Error(err.message);
  }
}

export async function getCurrentUser(): Promise<User> {
  try {
    const config = await getCombinedConfig();
    const user: User = {
      name: config.user.name,
      email: config.user.email,
      privateKey: config[`remote "origin"`]!.gtPrivateKeyPath!,
      gpgKey: config.user.signingKey
    };
    return user;
  } catch (err) {
    throw new Error(err.message);
  }
}

async function getConfig(scope: ConfigScope): Promise<GitConfig> {
  const data = await promisify(fs.readFile)(CONFIG_PATH[scope], 'utf-8');
  return ini.parse(data) as GitConfig;
}

export async function getGlobalConfig(): Promise<GitConfig> {
  return getConfig('global');
}

export async function getLocalConfig(): Promise<GitConfig> {
  return getConfig('local');
}

export async function getCombinedConfig(): Promise<GitConfig> {
  const configList = await Promise.all([getGlobalConfig(), getLocalConfig()]);
  return {...configList[0], ...configList[1]};
}

function setConfig(entries: GitConfigParams, scope: ConfigScope = 'local') {
  for (const key of Object.keys(entries) as Array<keyof GitConfigParams>) {
    execa.sync(`git config --${scope} '${key}' '${entries[key]}'`, {
      shell: true,
    });
  }
}

export function setGlobalConfig(entries: GitConfigParams) {
  return setConfig(entries, 'global');
}

export function setLocalConfig(entries: GitConfigParams) {
  return setConfig(entries, 'local');
}
