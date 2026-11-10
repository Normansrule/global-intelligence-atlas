# Security

Global Intelligence Atlas (GIA) is a static website, an optional Cloudflare Worker proxy and a Tauri desktop app.
It has no accounts, no server database and no logins, so there is little to steal. What can still go wrong: a data
feed could carry hostile text that runs as code in your browser, a link could take you somewhere unsafe, the desktop
app could be used to reach your home network, or the GitHub repository could be taken over through its automation.
This file says how each of those is closed off, what is still open, and how to report a problem.

## Reporting a problem

Please use **Report a vulnerability** on the repository's Security tab (GitHub private vulnerability reporting), so
the details stay private until a fix is out. Do not open a public issue for a security problem.

## What protects you (v2.14)

**The website**
- Every page carries a Content Security Policy (CSP). Only the site's own script files run: no inline scripts, no
  inline event handlers, no `eval`, no plug-ins (`object-src 'none'`), no changing the page's base address, and
  frames only from YouTube's two embed hosts.
- Every value from a feed is escaped before it goes into the page. `tests/e2e/test_security.py` checks this the
  hard way: it puts an HTML and script payload into every name, title, place and description of every feed and of
  the site's own data files, opens each layer's pages, and fails if any of it becomes a real element or runs.
- `site/app/js/guard.js` is a second line of defence: it strips inline handlers from any HTML that reaches the page,
  takes the address off `javascript:` and `data:` links, adds `noopener` to links that open a new tab, and sandboxes
  any frame the app did not sandbox itself. Live TV frames are sandboxed so they cannot move the Atlas page.
- Plug-in names from the address bar must be a plain file name in `app/plugins/` (`registry.js`), and the address
  bar's place, layer and selection values are only ever matched against known values.
- The service worker never stores opaque answers from other sites, and saved data is only ever read as data, never run as code.
- Nothing you type is sent anywhere except the data source it is for. An AISStream key you enter stays in your
  browser's local storage and goes only to AISStream.

**The desktop app** (`desktop/`)
- The same CSP, applied by Tauri as well as by the pages.
- The page can ask the app to fetch data natively (`fetch_text`), but only `https://` addresses on the standard port,
  on a fixed list of data hosts, with no user name or password in the address. Every redirect must land on a listed
  host too, so an allowed host cannot bounce the request to your router or another site. Answers over 48 MB are
  refused.
- The window may only open web, mail and phone links in your normal browser (`opener:allow-default-urls`); it
  cannot open files or folders. Web pages from other sites never get access to the app's commands.
- Microsoft Edge WebView2's SmartScreen check is left on.

**The proxy** (`proxy/worker.js`, optional)
- Only `GET`, only listed hosts over `https://` on the standard port, and a redirect may not leave the list (except
  rdap.org handing a query on to the registry that holds it).
- Browsers on other websites are turned away, and every answer is sent as inert data (`nosniff`, a sandboxing CSP).

**The repository and its automation** (`.github/workflows/`)
- Every action from another repository is pinned to a full commit SHA, so a moved tag cannot change what runs.
- Every workflow states the least token permissions it needs; read-only workflows do not keep the token in the
  checked-out copy (`persist-credentials: false`).
- No workflow pastes form input or event text into a shell command; it goes through environment variables.
- No `pull_request_target`, so a stranger's pull request never runs with this repository's secrets.
- `tools/check-workflows.py` enforces the four rules above on every push.
- `security.yml` runs GitHub CodeQL on the JavaScript and the workflows, RustSec (`cargo audit`) on the desktop
  app's crates and `npm audit` on its build tool, every push and every Monday. The desktop build tool is pinned to
  an exact version with a lock file, installed with `npm ci --ignore-scripts`.
- API keys live only in GitHub Actions secrets, are passed to the one step that needs each, and are never printed.

## What is still open (honest limits)

No software can be made impossible to attack. These are the known gaps, and why they remain:

1. **GitHub Pages cannot send security headers.** The CSP is a `<meta>` tag, which cannot forbid framing
   (`frame-ancestors`), so another site could show the Atlas inside a frame. There is nothing on the Atlas to click
   that changes an account or spends money, so the harm is small. Moving the site behind Cloudflare Pages would allow
   real headers.
2. **Styles may be inline** (`style-src 'unsafe-inline'`) because the app sets thousands of positions and colours in
   `style` attributes. Injected CSS cannot run code, but could change how a page looks.
3. **Pictures, video and data may come from any `https:` host** (`img-src`, `media-src`, `connect-src`), because
   cameras, news photos and feeds come from thousands of public sites. Scripts cannot, so this does not allow code
   to run; it means a hostile feed could make your browser load a picture from a site it chose.
4. **The data itself can be wrong.** Feeds are public sources the Atlas does not control. A feed can be late, wrong
   or deliberately misleading; the Atlas shows where each value came from so you can judge it.
5. **The desktop builds are not code-signed** (signing certificates cost money). Download them only from this
   repository's Releases page. Windows and macOS will warn the first time; the Download page explains how to open them.
6. **The third-party libraries in `site/app/vendor/`** (three.js bundle, pdf.js, hls.js, Astronomy Engine) are
   copies checked into the repository. They are not fetched from a CDN, so a CDN cannot change them, but they are
   updated by hand.
7. **Your GitHub account is the key to everything.** Use two-factor authentication, keep the `gh` token on your own
   computer, and leave GitHub secret scanning and push protection on.
