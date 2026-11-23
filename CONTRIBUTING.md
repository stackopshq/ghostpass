# Contributing to GhostPass

Thank you for looking. A few things will save you time.

## Where to open a pull request

**GitHub is a mirror.** Development happens on GitLab, and every push to `main`
there overwrites `main` here.

A pull request merged on GitHub **would be silently overwritten** at the next
push. This is not a preference — it is a mechanical fact of how the mirror
works, and it has already cost someone their work elsewhere in this estate.

So nothing is merged on GitHub. Open your pull request there anyway: we review
it, carry it over, and keep you as the author of your commits.

## Before you write code

**Build the WASM core first.** It is a `file:` dependency of the web app, so a
fresh clone without it fails with type errors that look like something else
entirely:

```bash
cd crates/ghostpass-crypto-wasm && wasm-pack build --target web
```

Then:

```bash
cd apps/server   && npm install && npm run dev   # :3000, SQLite in dev
cd apps/web-next && npm install && npm run dev   # :5173, /api proxied
```

## What the checks will ask of you

`main` is protected. Eight checks run on every pull request, and they must all
be green — for us as well:

```bash
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test --all
cd apps/server   && npm run typecheck && npm test
cd apps/web-next && npm run typecheck && npm test && npm run build
```

These are the `crypto`, `server` and `web` jobs of `.gitlab-ci.yml`, command for
command. The web app has no lint script: type checking, its tests and the build
are what the CI asks of it.

Run them locally rather than discovering them in CI. A job stops at its first
failure, so a green local run of one command says nothing about the next.

## How this codebase is written

**Comments explain *why*, not *what*.** The code says what it does. What it
cannot say is the measurement, the incident or the constraint that produced a
decision — and that is precisely what the next person needs.

Two consequences worth stating, because they come up in review:

- **When you change a value, check the comment above it is still true.** A stale
  justification costs more than a wrong value: it discourages reopening the
  question. We removed one recently that argued from a component which had left
  the machine two weeks earlier.
- **A guard that no longer guards anything should be deleted, not documented.**
  Explaining a useless check asks every future reader to re-derive that it is
  useless.

## Tests

Assert what would have caught the bug, not what the code happens to do.

Two habits from this repo, both learned the hard way:

- **Assert what must NOT be there.** The export test checks that the password
  hash and the MFA secret are *absent*. A test that only checks the happy fields
  passes while the file leaks.
- **Test both directions of a filter.** The retention test asserts that old rows
  go *and* that recent rows stay. An over-broad purge is silent data loss that
  reads as success.

If a test cannot fail, it is not a test. We had one that reached a log
serialiser through an internal library symbol; it was green and measured
nothing.

## Security

Do **not** open a public issue for a vulnerability. Write to
**contact@stackops.ch** — see [`.well-known/security.txt`](apps/web-next/public/.well-known/security.txt).
Acknowledgement within 72 hours, and credit if you want it.

## The one rule that is not negotiable

**The server must never be able to decrypt.** Any change that puts a key, a
plaintext, or a decryption primitive on the server side will be refused,
however convenient it is.

This command must keep returning zero:

```bash
grep -rni "chacha" apps/server/src | wc -l
```

XChaCha20-Poly1305 seals every vault, and it lives only in the Rust core. The
server holds exactly one decryption primitive, and it is named rather than
hidden: `services/secretAtRest.ts` reads the second-factor seed back with
AES-256-GCM, because checking a six-digit code requires that seed. It opens
nothing else. That is why a wider search such as
`grep -rniE "decrypt|chacha|aes|subtle" apps/server/src` does not return zero,
and the README says so. Adding a second such primitive is the change that will
be refused.

It is the whole product. Everything else is negotiable.
