import { createServer, IncomingMessage, ServerResponse, type Server } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Socket } from 'node:net'
import { createClient, type Client, type InArgs } from '@libsql/client'
import { createApp, createEvent, eventHandler, setCookie, toNodeListener } from 'h3'
import { hashPassword, verifyPassword } from '../server/db/passwords'
import {
  findAccountByEmail,
  findSessionAccountId,
  deleteMemoForAccount,
  getMemo,
  getMemoForAccount,
  getSavedFilter,
  insertAccount,
  insertMemo,
  saveMemoIfCurrentVersion,
  insertSavedFilter,
  insertSecurityCode,
  insertSession,
  insertTag,
  linkMemoTag,
  listMemosForAccount,
  StorageError,
} from '../server/db/records'
import { ensureSchema } from '../server/db/schema'
import {
  applySessionCookie,
  createSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from '../server/db/session-cookie'
import { resolveTursoConfig } from '../server/db/turso-config'

const root = process.cwd()

async function main(): Promise<void> {
  assertClientSourceDoesNotTouchSecrets()
  assertTursoConfigResolution()
  assertSessionCookieOptions()
  await verifyDatabase()
  const probe = await startCookieProbe()
  await assertCookieProbe(probe)
  if (process.argv.includes('--serve')) {
    console.log(`COOKIE_PROBE_URL=${probe.url}`)
    await new Promise(() => {})
  }
  await probe.close()
  console.log('저장소와 세션 검증을 통과했습니다.')
}

function assertClientSourceDoesNotTouchSecrets(): void {
  const config = readFileSync(join(root, 'nuxt.config.ts'), 'utf8')
  assert(!config.includes('TURSO_'), 'nuxt 설정에 Turso 환경 변수 이름이 있습니다.')
  assert(!config.includes('libsql://'), 'nuxt 설정에 데이터베이스 주소가 있습니다.')
  assert(!/public\s*:\s*\{[^}]*turso/i.test(config), 'Turso 설정이 공개 런타임 설정에 있습니다.')

  const clientFiles = walk(root).filter((file) => {
    const relative = file.slice(root.length).replaceAll('\\', '/')
    return !relative.endsWith('/nuxt.config.ts')
      && !relative.includes('/server/')
      && !relative.includes('/scripts/')
      && !relative.includes('/node_modules/')
      && !relative.includes('/.nuxt/')
      && !relative.includes('/.output/')
      && /\.(vue|ts|js|mjs)$/.test(relative)
  })
  const forbidden = ['@libsql/client', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'tursoAuthToken', 'tursoDatabaseUrl', 'password_hash', 'hashPassword']
  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8')
    for (const word of forbidden) {
      assert(!source.includes(word), `${file}에 ${word}가 있습니다.`)
    }
  }

  for (const file of walk(join(root, 'server', 'api'))) {
    const source = readFileSync(file, 'utf8')
    assert(!source.includes('turso'), `${file} 응답 경로에 Turso 설정이 있습니다.`)
    assert(!source.includes('password'), `${file} 응답 경로에 비밀번호가 있습니다.`)
    assert(!source.includes('runtimeConfig'), `${file}이 런타임 설정을 읽습니다.`)
  }

  const sessionSource = readFileSync(join(root, 'server', 'utils', 'session.ts'), 'utf8')
  assert(sessionSource.includes('applySessionCookie'), '세션이 쿠키로 기록되지 않습니다.')
  assert(!sessionSource.includes('localStorage'), '세션이 브라우저 저장소를 사용합니다.')
  assert(!sessionSource.includes('return token'), '세션 토큰을 응답 값으로 돌려줍니다.')
  const cookieSource = readFileSync(join(root, 'server', 'db', 'session-cookie.ts'), 'utf8')
  assert(cookieSource.includes('httpOnly: true'), '세션 쿠키가 httpOnly가 아닙니다.')
  assert(!cookieSource.includes('httpOnly: false'), 'httpOnly를 끄는 경로가 있습니다.')
}

function assertTursoConfigResolution(): void {
  const resolved = resolveTursoConfig({
    runtimeUrl: ' libsql://runtime.turso.io ',
    runtimeToken: '',
    databaseUrl: 'libsql://env.turso.io',
    authToken: ' env-token ',
  })
  assert(resolved.url === 'libsql://runtime.turso.io', '런타임 주소를 우선하지 않습니다.')
  assert(resolved.authToken === 'env-token', '비어 있는 런타임 토큰 다음으로 환경 변수를 읽지 않습니다.')
  const fallback = resolveTursoConfig({
    runtimeUrl: '',
    runtimeToken: ' runtime-token ',
    databaseUrl: 'libsql://env.turso.io',
    authToken: 'env-token',
  })
  assert(fallback.url === 'libsql://env.turso.io', 'TURSO_DATABASE_URL을 읽지 않습니다.')
  assert(fallback.authToken === 'runtime-token', '런타임 토큰을 우선하지 않습니다.')
  const pulled = resolveTursoConfig({
    runtimeUrl: '',
    runtimeToken: '',
    databaseUrl: '',
    authToken: '',
    dbUrl: ' libsql://pulled.turso.io ',
    dbToken: ' pulled-token ',
  })
  assert(pulled.url === 'libsql://pulled.turso.io', 'TURSO_DB_URL을 읽지 않습니다.')
  assert(pulled.authToken === 'pulled-token', 'TURSO_DB_TOKEN을 읽지 않습니다.')
}

function assertSessionCookieOptions(): void {
  const options = sessionCookieOptions(true)
  assert(options.httpOnly === true, 'httpOnly가 꺼져 있습니다.')
  assert(options.secure === true, 'HTTPS 쿠키에 Secure가 없습니다.')
  assert(options.sameSite === 'lax', 'SameSite가 lax가 아닙니다.')
  assert(options.path === '/', '쿠키 경로가 전체가 아닙니다.')
  assert(sessionCookieOptions(false).httpOnly === true, '개발 쿠키도 httpOnly여야 합니다.')
  assert(headerFor(false).includes('HttpOnly'), 'HTTP 응답 쿠키에 HttpOnly가 없습니다.')
  assert(!/;\s*Secure(?:;|$)/i.test(headerFor(false)), 'HTTP 응답 쿠키에 Secure가 있습니다.')
  const secureHeader = headerFor(true)
  assert(secureHeader.includes('HttpOnly'), 'HTTPS 응답 쿠키에 HttpOnly가 없습니다.')
  assert(/;\s*Secure(?:;|$)/i.test(secureHeader), 'HTTPS 응답 쿠키에 Secure가 없습니다.')
}

function headerFor(secure: boolean): string {
  const request = new IncomingMessage(new Socket())
  if (secure) {
    request.headers['x-forwarded-proto'] = 'https'
  }
  const response = new ServerResponse(request)
  applySessionCookie(createEvent(request, response), 'token-value')
  const header = response.getHeader('set-cookie')
  return Array.isArray(header) ? header.join('\n') : String(header ?? '')
}

async function verifyDatabase(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    await ensureSchema(db)
    await ensureSchema(db)
    const foreignKeys = await db.execute('PRAGMA foreign_keys')
    assert(Number(foreignKeys.rows[0]?.foreign_keys) === 1, '외래 키가 꺼져 있습니다.')
    await assertColumns(db)

    const password = 'plain-password-should-not-be-stored'
    const account = await insertAccount(db, { email: ' User@Example.com ', password })
    const stored = await findAccountByEmail(db, 'user@example.com')
    assert(stored?.id === account.id, '계정을 이메일로 찾지 못했습니다.')
    assert(stored.passwordHash.startsWith('scrypt$'), '비밀번호가 해시 형식이 아닙니다.')
    assert(stored.passwordHash !== password, '비밀번호 원문이 저장되었습니다.')
    assert(!stored.passwordHash.includes(password), '해시에 비밀번호 원문이 포함되어 있습니다.')
    assert(await verifyPassword(password, stored.passwordHash), '비밀번호 해시가 검증되지 않습니다.')
    assert(!(await verifyPassword(`${password}x`, stored.passwordHash)), '다른 비밀번호가 통과했습니다.')
    await rejectsWith(
      () => insertAccount(db, { email: 'user@example.com', password: 'another-password' }),
      '이미 가입된 이메일입니다.',
    )
    await rejects(() => db.execute({
      sql: `INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
      args: ['plaintext-account', 'plain@example.com', password, new Date().toISOString()],
    }))

    const rawAccount = await db.execute({
      sql: 'SELECT * FROM accounts WHERE id = ?',
      args: [account.id],
    })
    const columns = Object.keys(rawAccount.rows[0] ?? {})
    assert(!columns.includes('password'), '계정 행에 password 열이 있습니다.')
    assert(columns.includes('password_hash'), '계정 행에 password_hash 열이 없습니다.')

    const token = createSessionToken()
    const tokenHash = hashSessionToken(token)
    await insertSession(db, {
      tokenHash,
      accountId: account.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    assert(await findSessionAccountId(db, tokenHash) === account.id, '세션으로 계정을 찾지 못했습니다.')
    const sessionRow = await db.execute('SELECT token_hash FROM sessions')
    assert(String(sessionRow.rows[0]?.token_hash) === tokenHash, '세션 테이블에 해시가 없습니다.')
    assert(!JSON.stringify(sessionRow.rows).includes(token), '세션 테이블에 쿠키 값이 있습니다.')
    await rejects(() => db.execute({
      sql: `INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      args: [token, account.id, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString()],
    }))
    const expiredToken = createSessionToken()
    await insertSession(db, {
      tokenHash: hashSessionToken(expiredToken),
      accountId: account.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    assert(await findSessionAccountId(db, hashSessionToken(expiredToken)) === null, '만료 세션이 살아 있습니다.')

    const loginCode = await insertSecurityCode(db, {
      accountId: account.id,
      code: '01234567',
      purpose: 'login',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const changeCode = await insertSecurityCode(db, {
      accountId: account.id,
      code: '76543210',
      purpose: 'password_change',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const codes = await db.execute({
      sql: 'SELECT code, purpose, expires_at FROM security_codes WHERE id IN (?, ?) ORDER BY purpose',
      args: [loginCode.id, changeCode.id],
    })
    assert(codes.rows.length === 2, '보안코드 두 종류를 저장하지 못했습니다.')
    assert(codes.rows.every((row) => /^\d{8}$/.test(String(row.code))), '보안코드가 숫자 8자리가 아닙니다.')
    assert(String(codes.rows[0]?.purpose) === 'login', '로그인 목적이 저장되지 않았습니다.')
    assert(String(codes.rows[1]?.purpose) === 'password_change', '비밀번호 변경 목적이 저장되지 않았습니다.')
    await rejectsWith(
      () => insertSecurityCode(db, {
        accountId: account.id,
        code: '1234567',
        purpose: 'login',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      '보안코드는 숫자 8자리여야 합니다.',
    )
    await rejects(() => db.execute({
      sql: `INSERT INTO security_codes (id, account_id, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['bad-purpose', account.id, '12345678', 'signup', new Date().toISOString(), new Date().toISOString()],
    }))

    const memo = await insertMemo(db, { accountId: account.id, body: '# 회의\n본문' })
    const versioned = await insertMemo(db, { accountId: account.id, body: '', version: 3 })
    assert((await getMemo(db, memo.id))?.body === '# 회의\n본문', '마크다운 본문이 저장되지 않았습니다.')
    assert((await getMemo(db, memo.id))?.version === 1, '기본 저장 버전이 1이 아닙니다.')
    assert((await getMemo(db, versioned.id))?.version === 3, '저장 버전을 기록하지 못했습니다.')
    await rejectsWith(
      () => insertMemo(db, { accountId: account.id, body: 'x', version: 0 }),
      '저장 버전은 1 이상의 정수여야 합니다.',
    )

    const other = await insertAccount(db, { email: 'other@example.com', password: 'other-password-value' })
    const editable = await insertMemo(db, { accountId: account.id, body: '처음' })
    const savedOnce = await saveMemoIfCurrentVersion(db, {
      accountId: account.id,
      id: editable.id,
      body: '고친 본문',
      baseVersion: 1,
    })
    assert(savedOnce.kind === 'saved' && savedOnce.memo.body === '고친 본문' && savedOnce.memo.version === 2, '같은 버전으로 본문을 저장하지 못했습니다.')
    assert((await getMemo(db, editable.id))?.body === '고친 본문', '저장한 본문이 조회되지 않습니다.')
    assert((await getMemo(db, editable.id))?.version === 2, '저장 후 버전이 올라가지 않았습니다.')
    const conflicted = await saveMemoIfCurrentVersion(db, {
      accountId: account.id,
      id: editable.id,
      body: '덮어쓰면 안 되는 본문',
      baseVersion: 1,
    })
    assert(conflicted.kind === 'conflict', '다른 저장 버전을 충돌로 두지 않았습니다.')
    assert((await getMemo(db, editable.id))?.body === '고친 본문', '충돌 때 서버 본문을 덮어썼습니다.')
    assert((await getMemo(db, editable.id))?.version === 2, '충돌 때 저장 버전이 바뀌었습니다.')
    const emptySaved = await saveMemoIfCurrentVersion(db, {
      accountId: account.id,
      id: editable.id,
      body: '',
      baseVersion: 2,
    })
    assert(emptySaved.kind === 'saved' && emptySaved.memo.version === 3, '빈 본문을 저장하지 못했습니다.')
    assert((await getMemo(db, editable.id))?.body === '', '빈 본문이 반영되지 않았습니다.')
    const foreignSave = await saveMemoIfCurrentVersion(db, {
      accountId: other.id,
      id: editable.id,
      body: '다른 계정',
      baseVersion: 3,
    })
    assert(foreignSave.kind === 'missing', '다른 계정의 메모가 저장되었습니다.')
    assert((await getMemo(db, editable.id))?.body === '', '다른 계정 저장 시도가 본문을 바꿨습니다.')
    const missingSave = await saveMemoIfCurrentVersion(db, {
      accountId: account.id,
      id: 'missing-memo',
      body: '없음',
      baseVersion: 1,
    })
    assert(missingSave.kind === 'missing', '없는 메모 저장을 구분하지 못했습니다.')
    await rejectsWith(
      () => saveMemoIfCurrentVersion(db, {
        accountId: account.id,
        id: editable.id,
        body: 'x',
        baseVersion: 0,
      }),
      '저장 버전이 올바르지 않습니다.',
    )
    const work = await insertTag(db, { accountId: account.id, name: '업무' })
    const urgent = await insertTag(db, { accountId: account.id, name: '긴급' })
    const personal = await insertTag(db, { accountId: account.id, name: '개인' })
    const sameName = await insertTag(db, { accountId: other.id, name: '업무' })
    assert(sameName.id !== work.id, '다른 계정의 같은 태그 이름을 구분하지 못했습니다.')
    await linkMemoTag(db, { memoId: memo.id, tagId: work.id })
    await linkMemoTag(db, { memoId: memo.id, tagId: urgent.id })
    await rejectsWith(
      () => linkMemoTag(db, { memoId: memo.id, tagId: work.id }),
      '이미 연결된 태그입니다.',
    )
    await rejectsWith(
      () => linkMemoTag(db, { memoId: memo.id, tagId: sameName.id }),
      '다른 계정의 태그는 연결할 수 없습니다.',
    )

    const filter = await insertSavedFilter(db, {
      accountId: account.id,
      name: '회의 필터',
      includeTagIds: [work.id, urgent.id, work.id],
      excludeTagIds: [personal.id],
      keyword: '회의',
    })
    const saved = await getSavedFilter(db, filter.id)
    assert(saved?.name === '회의 필터', '필터 이름이 저장되지 않았습니다.')
    assert(saved.keyword === '회의', '필터 키워드가 하나가 아닙니다.')
    assert(JSON.stringify(saved.includeTagIds) === JSON.stringify([work.id, urgent.id]), '포함 태그 목록이 다릅니다.')
    assert(JSON.stringify(saved.excludeTagIds) === JSON.stringify([personal.id]), '제외 태그 목록이 다릅니다.')
    const emptyKeyword = await insertSavedFilter(db, {
      accountId: account.id,
      name: '키워드 없음',
      includeTagIds: [],
      excludeTagIds: [],
      keyword: '',
    })
    assert((await getSavedFilter(db, emptyKeyword.id))?.keyword === '', '빈 키워드를 저장하지 못했습니다.')

    const early = await insertMemo(db, { accountId: account.id, body: '먼저 수정' })
    const late = await insertMemo(db, { accountId: account.id, body: '나중에 수정' })
    await db.execute({
      sql: `UPDATE memos SET updated_at = ? WHERE id = ?`,
      args: ['2020-01-01T00:00:00.000Z', early.id],
    })
    await db.execute({
      sql: `UPDATE memos SET updated_at = ? WHERE id = ?`,
      args: ['2024-06-01T00:00:00.000Z', late.id],
    })
    const foreign = await insertMemo(db, { accountId: other.id, body: '다른 계정 메모' })
    const ownMemos = await listMemosForAccount(db, account.id)
    const ownIds = ownMemos.map((item) => item.id)
    assert(ownMemos.every((item) => item.accountId === account.id), '목록에 다른 계정의 메모가 있습니다.')
    assert(!ownIds.includes(foreign.id), '다른 계정의 메모가 목록에 있습니다.')
    assert(ownIds.includes(versioned.id) && ownMemos.some((item) => item.id === versioned.id && item.body === ''), '빈 메모가 목록에 없습니다.')
    assert(ownIds.indexOf(late.id) >= 0 && ownIds.indexOf(late.id) < ownIds.indexOf(early.id), '최근 수정 순이 아닙니다.')
    assert(await getMemoForAccount(db, account.id, foreign.id) === null, '다른 계정의 메모가 조회됩니다.')
    assert(await deleteMemoForAccount(db, { accountId: account.id, id: foreign.id }) === false, '다른 계정의 메모가 삭제되었습니다.')
    assert((await getMemo(db, foreign.id))?.body === '다른 계정 메모', '다른 계정 메모 본문이 사라졌습니다.')

    const doomed = await insertMemo(db, { accountId: account.id, body: '삭제 대상' })
    await linkMemoTag(db, { memoId: doomed.id, tagId: personal.id })
    const tagCount = await count(db, 'SELECT count(*) AS n FROM tags')
    const filterCount = await count(db, 'SELECT count(*) AS n FROM saved_filters')
    const otherLinks = await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ?', [memo.id])
    assert(await deleteMemoForAccount(db, { accountId: account.id, id: doomed.id }), '메모를 삭제하지 못했습니다.')
    assert(await getMemo(db, doomed.id) === null, '삭제한 메모 본문이 조회됩니다.')
    assert(await getMemoForAccount(db, account.id, doomed.id) === null, '삭제한 메모가 계정 조회에 남습니다.')
    assert(!(await listMemosForAccount(db, account.id)).some((item) => item.id === doomed.id), '삭제한 메모가 목록에 남습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ?', [doomed.id]) === 0, '삭제한 메모의 태그 연결이 남았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM tags WHERE id = ?', [personal.id]) === 1, '메모 삭제 때 태그 행이 지워졌습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM tags') === tagCount, '메모 삭제가 다른 태그 행을 바꿨습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ?', [memo.id]) === otherLinks, '다른 메모의 태그 연결이 지워졌습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters') === filterCount, '메모 삭제가 필터를 바꿨습니다.')
    await rejectsWith(
      () => insertSavedFilter(db, {
        accountId: account.id,
        name: '겹침',
        includeTagIds: [work.id],
        excludeTagIds: [work.id],
        keyword: '회의',
      }),
      '포함 태그와 제외 태그에 같은 태그가 있습니다.',
    )
    await rejectsWith(
      () => insertSavedFilter(db, {
        accountId: account.id,
        name: '남의 태그',
        includeTagIds: [sameName.id],
        excludeTagIds: [],
        keyword: '',
      }),
      '이 계정의 태그만 필터에 넣을 수 있습니다.',
    )

    await db.execute({ sql: 'DELETE FROM tags WHERE id = ?', args: [work.id] })
    assert(await count(db, 'SELECT count(*) AS n FROM memos WHERE id = ?', [memo.id]) === 1, '태그를 지울 때 메모가 지워졌습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 0, '태그 삭제 후 메모 연결이 남았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters WHERE id = ?', [filter.id]) === 1, '태그 삭제 후 필터가 지워졌습니다.')
    const afterTagDelete = await getSavedFilter(db, filter.id)
    assert(JSON.stringify(afterTagDelete?.includeTagIds) === JSON.stringify([urgent.id]), '삭제한 태그가 포함 목록에 남았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM tags WHERE id = ?', [urgent.id]) === 1, '다른 태그가 지워졌습니다.')

    await db.execute({ sql: 'DELETE FROM memos WHERE id = ?', args: [memo.id] })
    assert(await getMemo(db, memo.id) === null, '삭제한 메모가 조회됩니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ?', [memo.id]) === 0, '메모 삭제 후 태그 연결이 남았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM tags WHERE id = ?', [urgent.id]) === 1, '메모 삭제 후 태그가 지워졌습니다.')
  } finally {
    db.close()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
}

async function assertColumns(db: Client): Promise<void> {
  const expected: Record<string, string[]> = {
    accounts: ['id', 'email', 'password_hash', 'created_at'],
    sessions: ['token_hash', 'account_id', 'expires_at', 'created_at'],
    security_codes: ['id', 'account_id', 'code', 'purpose', 'expires_at', 'created_at'],
    memos: ['id', 'account_id', 'body', 'version', 'created_at', 'updated_at'],
    tags: ['id', 'account_id', 'name', 'created_at', 'updated_at'],
    memo_tags: ['memo_id', 'tag_id'],
    saved_filters: ['id', 'account_id', 'name', 'keyword', 'created_at'],
    saved_filter_tags: ['filter_id', 'tag_id', 'kind', 'position'],
  }
  for (const [table, columns] of Object.entries(expected)) {
    const result = await db.execute(`PRAGMA table_info(${table})`)
    const names = result.rows.map((row) => String(row.name))
    assert(JSON.stringify(names) === JSON.stringify(columns), `${table} 열이 예상과 다릅니다: ${names.join(', ')}`)
  }
}

type CookieProbe = {
  url: string
  token: string
  close: () => Promise<void>
}

async function startCookieProbe(): Promise<CookieProbe> {
  const token = createSessionToken()
  const app = createApp()
  app.use('/page', eventHandler((event) => {
    applySessionCookie(event, token)
    setCookie(event, 'probe', '1', { path: '/', sameSite: 'lax', httpOnly: false })
    event.node.res.setHeader('content-type', 'text/html; charset=utf-8')
    return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<title>쿠키 확인</title>
<p id="probe">확인 중</p>
<p id="session">확인 중</p>
<script>
  const visible = document.cookie
  document.getElementById('probe').textContent = visible.includes('probe=1')
    ? '일반 쿠키는 스크립트에 보입니다'
    : '일반 쿠키가 보이지 않습니다'
  document.getElementById('session').textContent = visible.includes('session=')
    ? '세션 쿠키가 스크립트에 보입니다'
    : '세션 쿠키는 스크립트에 보이지 않습니다'
</script>
</html>`
  }))
  app.use(eventHandler((event) => {
    applySessionCookie(event, token)
    setCookie(event, 'probe', '1', { path: '/', sameSite: 'lax', httpOnly: false })
    return { ok: true }
  }))
  const server = createServer(toNodeListener(app))
  const port = await listen(server)
  return {
    url: `http://127.0.0.1:${port}/`,
    token,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

async function assertCookieProbe(probe: CookieProbe): Promise<void> {
  const response = await fetch(probe.url)
  const body = await response.text()
  assert(!body.includes(probe.token), 'API 응답 본문에 세션 쿠키 값이 있습니다.')
  assert(!body.includes('libsql://'), 'API 응답 본문에 데이터베이스 주소가 있습니다.')
  assert(!body.toLowerCase().includes('auth'), 'API 응답 본문에 인증 토큰 단서가 있습니다.')
  const cookies = response.headers.getSetCookie()
  const session = cookies.find((cookie) => cookie.startsWith('session='))
  const probeCookie = cookies.find((cookie) => cookie.startsWith('probe='))
  assert(session?.includes(probe.token), 'Set-Cookie에 세션 값이 없습니다.')
  assert(session !== undefined && /HttpOnly/i.test(session), 'Set-Cookie에 HttpOnly가 없습니다.')
  assert(session !== undefined && /SameSite=Lax/i.test(session), 'Set-Cookie의 SameSite가 lax가 아닙니다.')
  assert(probeCookie !== undefined && !/HttpOnly/i.test(probeCookie), '대조 쿠키가 HttpOnly입니다.')
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('쿠키 확인 서버의 포트를 열지 못했습니다.')
  }
  return address.port
}

async function count(db: Client, sql: string, args: InArgs): Promise<number> {
  const result = await db.execute({ sql, args })
  return Number(result.rows[0]?.n)
}

async function rejects(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch {
    return
  }
  throw new Error('거절되어야 할 저장이 통과했습니다.')
}

async function rejectsWith(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (error instanceof StorageError && error.message === message) {
      return
    }
    throw error
  }
  throw new Error(`거절 메시지가 필요합니다: ${message}`)
}

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return files
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.nuxt' || entry === '.output' || entry === '.data') {
      continue
    }
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path, files)
    } else {
      files.push(path)
    }
  }
  return files
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
