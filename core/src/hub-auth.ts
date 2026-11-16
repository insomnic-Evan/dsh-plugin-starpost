import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeBotId } from './config.ts';

type Post = (url: URL, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
interface Session {
  version: 1; server: string; issuer: string; botId: string; subject: string;
  installationId: string; deviceId: string; accessToken: string; expiresAt: number;
}
interface Pairing {
  version: 1; server: string; issuer: string; installationId: string; deviceId: string;
  pairingId: string; pollingSecret: string; shortCode: string; verificationUri: string;
  expectedBotId: string | null; expiresAt: number; approved?: any;
}
export function hubOrigin(value: string): string {
  const u = new URL(value);
  if (!(u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('FFA hub 地址须为 HTTPS 站点；隔离测试可用 HTTP 回环地址');
  return u.origin;
}
/** Human-only pairing state. Never expose access tokens or polling secrets to bot tools. */
export class HubAuth {
  private file: string;
  private pendingFile: string;
  private busy = false;
  private revision = 0;
  private checked: { token: string; until: number; routeEpoch: number } | null = null;
  constructor(private dir: string, private server: () => string, private issuer: () => string, private post: Post) {
    this.file = join(dir, 'starpost-hub-session.json'); this.pendingFile = join(dir, 'starpost-hub-pairing.json');
  }
  private save(file: string, value: unknown) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file);
  }
  private pin(value: { server: string; issuer: string }) {
    if (value.server !== hubOrigin(this.server()) || value.issuer !== hubOrigin(this.issuer())) throw Error('Hub 账号已绑定其他服务地址，请恢复原地址或使用独立的数据目录');
  }
  session(): Session | null {
    if (!existsSync(this.file)) return null;
    const s = JSON.parse(readFileSync(this.file, 'utf8')) as Session;
    if (s.version !== 1 || !normalizeBotId(s.botId) || typeof s.accessToken !== 'string' || s.accessToken.length < 24 || s.accessToken.length > 256 || !s.subject || !s.installationId || !s.deviceId || !Number.isSafeInteger(s.expiresAt)) throw Error('本机 Hub 登录文件损坏，请由人类重新配对；不会退回旧凭据');
    this.pin(s); return s;
  }
  private pending(): Pairing | null {
    if (!existsSync(this.pendingFile)) return null;
    const p = JSON.parse(readFileSync(this.pendingFile, 'utf8')) as Pairing;
    this.pin(p); return p;
  }
  status() {
    const s = this.session(), p = this.pending();
    return { mode: s ? 'hub' : 'legacy', ...(s ? { botId: s.botId, subject: s.subject, installationId: s.installationId, expiresAt: s.expiresAt, expired: s.expiresAt <= Date.now() } : {}),
      ...(p ? { pending: { shortCode: p.shortCode, verificationUri: p.verificationUri, expiresAt: p.expiresAt, approved: Boolean(p.approved) } } : {}) };
  }
  private async request(base: string, path: string, body: unknown) {
    const r = await this.post(new URL(path, base), body);
    if (r.status !== 200 || !r.body?.ok) throw Error(r.body?.message ?? r.body?.error ?? 'FFA hub 认证服务暂不可用');
    return r.body.result;
  }
  async begin(expectedBotId: string | null, label: string) {
    if (this.busy) throw Error('正在处理 Hub 配对');
    if (this.pending()) throw Error('已有待完成的 Hub 配对，请继续或先取消');
    this.busy = true; const revision = ++this.revision;
    try {
      const issuer = hubOrigin(this.issuer()), server = hubOrigin(this.server());
      const info = await this.request(server, '/hub/info', {});
      if (info.issuer !== issuer || info.service !== 'starpost') throw Error('星邮服务器配置的 Hub 与本机不一致');
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const installationId = randomUUID(), deviceId = randomUUID();
      const start = await this.request(issuer, '/v1/pairings', { service: 'starpost', label, deviceId, installationId, publicKey: publicKey.export({ format: 'jwk' }) });
      const uri = new URL(start.verificationUri);
      if (uri.origin !== issuer || uri.pathname !== '/' || uri.username || uri.password || uri.searchParams.get('pair') !== start.pairingId) throw Error('Hub 返回的配对地址不合法');
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ pairingId: start.pairingId, challenge: start.challenge, installationId, service: 'starpost' })).toString('base64url');
      const unsigned = `${header}.${payload}`, signature = sign(null, Buffer.from(unsigned), privateKey).toString('base64url');
      await this.request(issuer, '/v1/pairings/prove', { pairingId: start.pairingId, pollingSecret: start.pollingSecret, signature: `${unsigned}.${signature}` });
      if (revision !== this.revision) throw Error('配对已取消');
      this.save(this.pendingFile, { version: 1, issuer, server, installationId, deviceId, pairingId: start.pairingId, pollingSecret: start.pollingSecret, shortCode: start.shortCode, verificationUri: uri.href, expectedBotId, expiresAt: Date.now() + 300000 });
      return this.status();
    } finally { this.busy = false; }
  }
  cancel() { this.revision++; if (existsSync(this.pendingFile)) unlinkSync(this.pendingFile); return this.status(); }
  async finish(currentBotId: string | null = null) {
    if (this.busy) throw Error('正在处理 Hub 配对');
    const p = this.pending(); if (!p) throw Error('请先开始 Hub 配对');
    this.busy = true; const revision = this.revision;
    try {
      const approved = p.approved ?? await this.request(p.issuer, '/v1/pairings/poll', { pairingId: p.pairingId, pollingSecret: p.pollingSecret });
      if (revision !== this.revision) throw Error('配对已取消');
      if (approved.status !== 'approved') return { status: 'pending' };
      if (approved.issuer !== p.issuer || approved.audience !== 'starpost' || approved.installationId !== p.installationId || typeof approved.accessToken !== 'string') throw Error('配对回执与本机安装不匹配');
      this.save(this.pendingFile, { ...p, approved });
      const expectedBotId = currentBotId ?? p.expectedBotId;
      const result = await this.request(p.server, '/hub/connect', { token: approved.accessToken, installationId: p.installationId, deviceId: p.deviceId, expectedBotId });
      if (revision !== this.revision) throw Error('配对已取消');
      if (!normalizeBotId(result.botId) || expectedBotId && result.botId !== expectedBotId || result.subject !== approved.subject || result.issuer !== p.issuer) throw Error('选中的 Hub bot 与本机星邮账号不一致；原登录保持不变');
      if (!result.isPrimary) return { status: 'awaiting_primary', botId: result.botId, message: '请管理员在 FFA hub 将此安装设为主运行端，然后再次完成登录。现有登录保持不变。' };
      this.save(this.file, { version: 1, server: p.server, issuer: p.issuer, botId: result.botId, subject: result.subject, installationId: p.installationId, deviceId: p.deviceId, accessToken: approved.accessToken, expiresAt: result.expiresAt });
      this.invalidate(); this.cancel(); return { status: 'connected', botId: result.botId };
    } finally { this.busy = false; }
  }
  invalidate() { this.checked = null; }
  async headers(): Promise<Record<string, string>> {
    const s = this.session(); if (!s) throw Error('尚未通过 Hub 登录');
    if (s.expiresAt <= Date.now()) throw Error('FFA hub 安装授权已到期，请由人类重新配对；原记录保留');
    if (!this.checked || this.checked.token !== s.accessToken || this.checked.until <= Date.now()) {
      const r = await this.request(s.server, '/hub/session', { token: s.accessToken, installationId: s.installationId, deviceId: s.deviceId, expectedBotId: s.botId });
      if (r.subject !== s.subject || r.issuer !== s.issuer || r.botId !== s.botId) throw Error('Hub 账号归属已变更，请重新配对');
      if (!r.isPrimary) throw Error('本安装不是主运行端，请管理员在 FFA hub 选择；已暂停收发');
      this.checked = { token: s.accessToken, until: Date.now() + 20000, routeEpoch: r.routeEpoch };
    }
    return { authorization: `Bearer ${s.accessToken}`, 'x-starpost-id': s.botId, 'x-starpost-auth': 'ffa-hub', 'x-ffa-installation': s.installationId, 'x-ffa-device': s.deviceId, 'x-ffa-route-epoch': String(this.checked.routeEpoch) };
  }
}
