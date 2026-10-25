// Shared helpers for the P1-b Jev-option tests: a mocked System One transport, a
// capturing log sink and a loader that compiles the HEAD (main) version of a source file so the
// flag-off result is compared against the PRE-CHANGE code, not a re-statement of it.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import fs from 'node:fs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const require = createRequire(import.meta.url)

/** A fetch double. `reply` is `{status, body}`, a function of the parsed request, or an Error to throw. */
export function mockFetch(reply) {
  const calls = []
  const fn = async (url, init) => {
    const parsed = init && init.body ? JSON.parse(init.body) : null
    calls.push({ url, init, body: parsed })
    const r = typeof reply === 'function' ? reply(parsed) : reply
    if (r instanceof Error) throw r
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      json: async () => { if (r.malformed) throw new SyntaxError('bad json'); return r.body },
    }
  }
  fn.calls = calls
  return fn
}
export const ok = (answers) => ({ status: 200, body: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } } })
export const timeoutErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

export const choice = (key, probs, confidence) => ({ type: 'choice', choice: key, confidence, probabilities: probs })
export const noul = (p) => ({ type: 'noul', noul: p })
export const score = (s, levels, confidence = 0.9) => ({
  type: 'score', score: s, confidence,
  legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), `level ${i}`])),
})

/** The standard failure transports every item must survive with the pre-change output. */
export function failureTransports() {
  return {
    'client error (http-500)': mockFetch({ status: 500, body: {} }),
    'http-429 exhausted': mockFetch({ status: 429, body: {} }),
    timeout: mockFetch(timeoutErr()),
    network: mockFetch(new Error('ECONNREFUSED')),
    'malformed json': mockFetch({ status: 200, malformed: true }),
    'missing answers': mockFetch({ status: 200, body: { model: 'x' } }),
  }
}

/** Compile `relPath` as it is at git `rev` in a CommonJS wrapper; relative requires resolve in the live tree. */
export function loadAtRev(relPath, rev = 'main', stubs = {}) {
  const src = execFileSync('git', ['-C', ROOT, 'show', `${rev}:${relPath}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return compileCjs(src, path.join(ROOT, relPath), stubs)
}
export function loadCurrent(relPath, stubs = {}) {
  return compileCjs(fs.readFileSync(path.join(ROOT, relPath), 'utf8'), path.join(ROOT, relPath), stubs)
}
function compileCjs(src, file, stubs) {
  const real = createRequire(file)
  const req = (n) => {
    for (const [k, v] of Object.entries(stubs)) if (n === k || n.startsWith(k)) return typeof v === 'function' ? v(n) : v
    return real(n)
  }
  const mod = { exports: {} }
  const fn = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname, process) {${src}\n})`, { filename: file })
  fn(mod.exports, req, mod, file, path.dirname(file), process)
  return mod.exports
}

// Belt and braces: this container carries a real TYPESAFE_API_KEY. Any test that forgets to inject a
// transport must fail loudly instead of making a live call.
globalThis.fetch = async (url) => { throw new Error(`LIVE FETCH BLOCKED IN TEST: ${String(url).slice(0, 60)}`) }
