// Banco do redirecionador em SQLite (node:sqlite, Node 24). Contas com chave,
// links por (disparo, grupo, URL), cliques e o sal diário do hash de visitante.

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { newCode, withUtm } from './codes.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS links (
    code TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    dispatch_id TEXT NOT NULL,
    schedule_id TEXT,
    schedule_name TEXT,
    group_id TEXT NOT NULL,
    group_name TEXT,
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    creator_ip_hash TEXT,
    clicks_total INTEGER NOT NULL DEFAULT 0,
    unique_total INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS links_dispatch ON links (account_id, dispatch_id);
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    visitor_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS clicks_code ON clicks (code, at);
  CREATE TABLE IF NOT EXISTS salts (
    day TEXT PRIMARY KEY,
    salt TEXT NOT NULL
  );
`;

const hashKey = (key) => createHash('sha256').update(key).digest('hex');

/**
 * Abre (ou cria) o banco e devolve as operações que o servidor usa.
 * @param {string} path Caminho do arquivo SQLite (":memory:" nos testes).
 * @returns {object}
 */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const insertAccount = db.prepare('INSERT INTO accounts (name, api_key_hash, created_at) VALUES (?, ?, ?)');
  const selectAccount = db.prepare('SELECT id, name FROM accounts WHERE api_key_hash = ?');
  const insertLink = db.prepare(`INSERT INTO links
    (code, account_id, dispatch_id, schedule_id, schedule_name, group_id, group_name, url, final_url, created_at, creator_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectLink = db.prepare('SELECT * FROM links WHERE code = ?');
  const insertClick = db.prepare('INSERT INTO clicks (code, at, kind, visitor_hash) VALUES (?, ?, ?, ?)');
  const seenVisitor = db.prepare("SELECT 1 FROM clicks WHERE code = ? AND kind = 'human' AND visitor_hash = ? LIMIT 1");
  const bumpTotals = db.prepare('UPDATE links SET clicks_total = clicks_total + 1, unique_total = unique_total + ? WHERE code = ?');
  const sumByGroup = db.prepare(`SELECT group_id, SUM(clicks_total) AS clicks, SUM(unique_total) AS unique_clicks
    FROM links WHERE account_id = ? AND dispatch_id = ? GROUP BY group_id`);
  const selectSalt = db.prepare('SELECT salt FROM salts WHERE day = ?');
  const insertSalt = db.prepare('INSERT INTO salts (day, salt) VALUES (?, ?)');
  const deleteOld = db.prepare('DELETE FROM clicks WHERE at < ?');

  return {
    /**
     * Cria uma conta e devolve a chave em claro, uma única vez.
     * @param {string} name
     * @returns {{id: number, name: string, key: string}}
     */
    createAccount(name) {
      const key = newCode(32);
      const { lastInsertRowid } = insertAccount.run(name, hashKey(key), new Date().toISOString());
      return { id: Number(lastInsertRowid), name, key };
    },

    /**
     * Conta dona de uma chave, ou nulo.
     * @param {string} key
     * @returns {{id: number, name: string}|null}
     */
    accountByKey(key) {
      if (typeof key !== 'string' || !key) return null;
      const row = selectAccount.get(hashKey(key));
      // As linhas do node:sqlite vêm sem protótipo: devolve objetos comuns.
      return row ? { id: Number(row.id), name: row.name } : null;
    },

    /**
     * Cria um link por (grupo, URL) e devolve o mapa de links curtos.
     * @param {number} accountId
     * @param {{dispatchId: string, schedule: {id: string, name: string}, groups: Array<{id: string, name: string}>, urls: string[], utm: boolean}} input
     * @param {{publicUrl: string, creatorIpHash: string|null, now?: number}} options
     * @returns {Record<string, Record<string, string>>} `{ [groupId]: { [url]: shortUrl } }`
     */
    createLinks(accountId, { dispatchId, schedule, groups, urls, utm }, { publicUrl, creatorIpHash, now = Date.now() }) {
      const createdAt = new Date(now).toISOString();
      const base = String(publicUrl).replace(/\/+$/, '');
      const links = {};
      db.exec('BEGIN');
      try {
        for (const group of groups) {
          links[group.id] = {};
          for (const url of urls) {
            const code = newCode();
            const finalUrl = utm ? withUtm(url, { campaign: schedule.name, content: group.name }) : url;
            insertLink.run(code, accountId, dispatchId, schedule.id ?? null, schedule.name ?? null,
              group.id, group.name ?? null, url, finalUrl, createdAt, creatorIpHash);
            links[group.id][url] = `${base}/r/${code}`;
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return links;
    },

    /**
     * @param {string} code
     * @returns {object|null}
     */
    linkByCode(code) {
      const row = selectLink.get(code);
      return row ? { ...row } : null;
    },

    /**
     * Registra um acesso. Só "human" entra nos totais; único é por visitante
     * (hash com sal do dia) por código.
     * @param {string} code
     * @param {{kind: 'human'|'bot'|'preview', visitorHash: string, now?: number}} click
     * @returns {{unique: boolean}}
     */
    recordClick(code, { kind, visitorHash, now = Date.now() }) {
      const unique = kind === 'human' && !seenVisitor.get(code, visitorHash);
      insertClick.run(code, new Date(now).toISOString(), kind, visitorHash);
      if (kind === 'human') bumpTotals.run(unique ? 1 : 0, code);
      return { unique };
    },

    /**
     * Totais de um disparo, no total e por grupo.
     * @param {number} accountId
     * @param {string} dispatchId
     * @returns {{clicks: number, unique: number, groups: Record<string, {clicks: number, unique: number}>}}
     */
    clicksByDispatch(accountId, dispatchId) {
      const groups = {};
      let clicks = 0;
      let unique = 0;
      for (const row of sumByGroup.all(accountId, dispatchId)) {
        groups[row.group_id] = { clicks: Number(row.clicks), unique: Number(row.unique_clicks) };
        clicks += Number(row.clicks);
        unique += Number(row.unique_clicks);
      }
      return { clicks, unique, groups };
    },

    /**
     * Sal do dia (AAAA-MM-DD), criado na primeira vez e persistido para a
     * contagem de únicos sobreviver a reinício.
     * @param {string} day
     * @returns {string}
     */
    daySalt(day) {
      const found = selectSalt.get(day);
      if (found) return found.salt;
      const salt = randomBytes(16).toString('hex');
      insertSalt.run(day, salt);
      return salt;
    },

    /**
     * Apaga os cliques brutos anteriores ao instante; os totais em links ficam.
     * @param {string} isoBefore
     * @returns {number} Linhas apagadas.
     */
    purgeClicksBefore(isoBefore) {
      return Number(deleteOld.run(isoBefore).changes);
    },

    close() {
      db.close();
    },
  };
}
