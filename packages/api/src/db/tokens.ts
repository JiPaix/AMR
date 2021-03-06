import { Database } from './';
import { resolve } from 'node:path';
import { env } from 'node:process';
import crypto from 'node:crypto';

type RefreshToken = {
  token: string,
  expire: number
  master?: boolean
}

type AuthorizedToken = {
  token: string,
  expire: number
  parent: string
  master?: boolean
}
type Tokens = {
  refreshTokens: RefreshToken[],
  authorizedTokens: AuthorizedToken[]
}

export class TokenDatabase extends Database<Tokens> {

  constructor(tokens: { accessToken: string, refreshToken: string }) {
    super(resolve(env.USER_DATA, 'access_db.json'), { authorizedTokens: [], refreshTokens: [] });
    // remove expired or master tokens
    this.data.authorizedTokens = this.data.authorizedTokens.filter(t => t.expire > Date.now() && !t.master);
    this.data.refreshTokens = this.data.refreshTokens.filter(t => t.expire > Date.now() && !t.master);
    // add new tokens
    const refresh = { token: tokens.refreshToken, expire: Date.now() + 1000 * 60 * 60 * 24 * 7, master: true };
    this.data.refreshTokens.push(refresh);
    const authorized = { token: tokens.accessToken, expire: Date.now() + 1000 * 60 * 60 * 24 * 7, parent: refresh.token, master: true };
    this.data.authorizedTokens.push(authorized);
    // save
    this.write();
  }
  isExpired(token: RefreshToken) {
    return token.expire < Date.now();
  }
  areParent(parent:RefreshToken, child:AuthorizedToken) {
    return parent.token === child.parent;
  }
  generateAccess(refresh: RefreshToken, master = false) {
    const token = crypto.randomBytes(32).toString('hex');
    const in5minutes = Date.now() + (5 * 60 * 1000);
    const authorized = { token, expire: in5minutes, parent: refresh.token, master };
    this.addAccessToken(authorized);
    return authorized;
  }
  generateRefresh(master = false) {
    const token = crypto.randomBytes(32).toString('hex');
    const in7days = Date.now() + (7 * 24 * 60 * 60 * 1000);
    const refresh = { token, expire: in7days, master };
    this.addRefreshToken(refresh);
    return refresh;
  }
  findAccessToken(token: string) {
    return this.data.authorizedTokens.find(t => t.token === token);
  }

  findRefreshToken(token: string) {
    return this.data.refreshTokens.find(t => t.token === token);
  }

  removeAccessToken(access: AuthorizedToken) {
    this.data.authorizedTokens = this.data.authorizedTokens.filter(t => t.token !== access.token);
  }

  removeRefreshToken(refresh: RefreshToken) {
    this.data.authorizedTokens = this.data.authorizedTokens.filter(t => t.parent !== refresh.token);
    this.data.refreshTokens = this.data.refreshTokens.filter(t => t.token !== refresh.token);
  }

  addAccessToken(token: AuthorizedToken) {
    this.data.authorizedTokens.push(token);
    this.write();
  }

  addRefreshToken(token: RefreshToken) {
    this.data.refreshTokens.push(token);
    this.write();
  }
}
