import json, sys, re, os, time
from playwright.sync_api import sync_playwright

"""Browser smoke test: fake microphone, fake Speech SDK fed with tests/fixtures, real SDK for the
unreachable-Azure path. Run from the repo root:
    python3 -m http.server 8765 &
    python3 tests/browser/e2e.py
Needs Python Playwright with Chromium. Screenshots go to tests/browser/shots/ (git-ignored)."""
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = HERE
os.makedirs(f"{S}/shots", exist_ok=True)
BASE = os.environ.get("BASE_URL", "http://localhost:8765/")
KEY = "TESTKEY-0123456789abcdef"
SDK_PATH = "**/vendor/speech-sdk-1.52.0/microsoft.cognitiveservices.speech.sdk.bundle-min.js"
fake = open(f"{S}/fake-sdk.js").read()
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS " if cond else "FAIL ") + name, detail)

def fixture(name): return json.load(open(f"{ROOT}/tests/fixtures/{name}"))

def setup_page(browser, fx=None, token_status=200, real_sdk=False, **ctx):
    context = browser.new_context(permissions=["microphone"], **ctx)
    page = context.new_page()
    log = {"console": [], "requests": [], "csp": []}
    page.on("console", lambda m: log["console"].append(m.text))
    page.on("request", lambda r: log["requests"].append(r.url))
    page.on("websocket", lambda ws: log["requests"].append(ws.url))
    page.on("pageerror", lambda e: log["console"].append("PAGEERROR " + str(e)))
    if not real_sdk:
        page.route(SDK_PATH, lambda route: route.fulfill(status=200, content_type="application/javascript",
            body=f"window.__FIXTURE__={json.dumps(fx)};\n{fake}"))
    page.route("https://*.api.cognitive.microsoft.com/**", lambda route: route.fulfill(status=token_status, body="fake-token-abc" if token_status == 200 else "{}",
        headers={"Access-Control-Allow-Origin": "*"}))
    return context, page, log

def save_key(page, region="westeurope", remember=True):
    page.fill("#keyInput", KEY); page.select_option("#regionInput", region)
    if remember: page.check("#rememberInput")
    page.click("#saveKey")

def record(page, text, seconds=3):
    page.fill("#text", text)
    page.click("#recordButton")
    page.wait_for_selector("body[data-state=recording]", timeout=10000)
    time.sleep(seconds)
    page.click("#recordButton")

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    en = fixture("en-US-continuous-3seg.json")

    # 1. setup, key save, en-US flow
    ctx, page, log = setup_page(browser, en, viewport={"width": 1100, "height": 900})
    page.goto(BASE)
    check("setup shown without a key", page.is_visible("#setup"))
    page.screenshot(path=f"{S}/shots/1-setup.png", full_page=True)
    save_key(page)
    page.wait_for_selector("body[data-state=idle]", timeout=5000)
    check("region shown by name", "West Europe" in page.text_content("#keyStatusText"), page.text_content("#keyStatusText"))
    check("default text is in the box on first visit", page.input_value("#text").startswith("That's one small step") and not page.is_disabled("#recordButton"))
    check("no sample list", page.locator("#sample").count() == 0)
    page.select_option("#locale", "es-ES")
    check("switching language swaps the untouched default", page.input_value("#text").startswith("Me llamo Luna"))
    page.fill("#text", "Mi propio texto.")
    page.select_option("#locale", "en-US")
    check("own text is kept when switching language", page.input_value("#text") == "Mi propio texto.")
    page.fill("#text", "")
    check("record disabled with empty text", page.is_disabled("#recordButton"))
    page.fill("#text", en["referenceText"])
    check("record enabled with text", not page.is_disabled("#recordButton"))
    page.screenshot(path=f"{S}/shots/2-idle.png", full_page=True)
    page.click("#recordButton")
    page.wait_for_selector("body[data-state=recording]", timeout=10000)
    time.sleep(2.5)
    check("recording starts from a cached token (no second issueToken)", sum("issueToken" in u for u in log["requests"]) == 1, str(sum("issueToken" in u for u in log["requests"])))
    check("live transcript shows partial", "every morning" in page.text_content("#live"))
    check("timer counts down", page.text_content("#timer") in ("1:58", "1:57", "1:59"), page.text_content("#timer"))
    page.screenshot(path=f"{S}/shots/3-recording.png", full_page=True)
    page.click("#recordButton")
    page.wait_for_selector("body[data-state=results]", timeout=15000)
    ring = page.text_content(".ring-value")
    check("score ring", ring == "55", ring)
    labels = page.eval_on_selector_all(".bar dt", "els => els.map(e => e.textContent)")
    check("four bars with prosody for en-US", labels == ["Accuracy", "Fluency", "Completeness", "Prosody"], str(labels))
    kinds = page.eval_on_selector_all(".reading .word", "els => els.map(e => e.className.match(/word--(\\w+)/)[1])")
    check("words rendered with marks", kinds.count("inserted") == 1 and kinds.count("mispronounced") >= 1 and kinds.count("omitted") > 50, str({k: kinds.count(k) for k in set(kinds)}))
    check("omitted words are not clickable", page.eval_on_selector_all(".reading .word--omitted", "els => els.every(e => e.tagName === 'SPAN')"))
    order = page.eval_on_selector_all("#results > *", "els => els.map(e => e.className)")
    check("reading, then marks bar, then summary", order[0] == "reading" and order[1] == "marks" and order[-1] == "summary", str(order))
    counters = page.eval_on_selector_all(".mark-toggle", "els => els.map(e => e.querySelector('.mark-count').textContent + ' ' + e.querySelector('.mark-label').textContent)")
    check("six counters for en-US", counters == ["1 Mispronounced", "63 Skipped", "1 Extra words", "6 Unexpected pauses", "1 Missing pauses", "3 Monotone phrases of 3"], str(counters))
    check("pause marks in the text", page.locator(".reading .pause--unexpected").count() == 6 and page.locator(".reading .pause--missing").count() == 1)
    page.click(".mark-toggle--monotone")
    check("toggle hides monotone underline", page.eval_on_selector(".reading", "e => e.classList.contains('hide-monotone')") and page.get_attribute(".mark-toggle--monotone", "aria-pressed") == "false")
    page.screenshot(path=f"{S}/shots/4b-monotone-off.png", full_page=True)
    page.click(".mark-toggle--monotone")
    page.hover(".reading .pause--unexpected >> nth=0")
    check("pause tooltip", "Unexpected pause" in page.text_content("#tooltip") and "0.35 s" in page.text_content("#tooltip"), page.text_content("#tooltip"))
    page.screenshot(path=f"{S}/shots/4-results.png", full_page=True)
    page.hover(".reading .word--mispronounced")
    tip = page.text_content("#tooltip")
    check("tooltip with IPA phonemes", page.is_visible("#tooltip") and "bakery" in tip and "ɹ" in tip, tip)
    page.screenshot(path=f"{S}/shots/5-tooltip.png")
    page.hover(".reading .word--inserted")
    check("insertion tooltip", "Extra word" in page.text_content("#tooltip"))
    page.click(".reading button.word >> nth=0")
    time.sleep(0.3)
    check("click to play works without errors", not any("PAGEERROR" in c for c in log["console"]), str(log["console"][-3:]))
    # key exposure
    leaked = [u for u in log["requests"] if KEY in u]
    check("key not in any request URL", not leaked, str(leaked))
    check("key not in console", not any(KEY in c for c in log["console"]))
    check("key not in page text", KEY not in page.inner_text("body"))
    # CSP
    blocked = page.evaluate("""async () => { try { await fetch('https://example.com/'); return 'fetched'; } catch (e) { return 'blocked'; } }""")
    check("CSP blocks non-Azure fetch", blocked == "blocked")
    # remember key -> reload keeps it
    page.reload(); page.wait_for_selector("body[data-state=idle]", timeout=5000)
    check("remembered key survives reload", page.is_visible("#practice"))
    stored = page.evaluate("Object.keys(localStorage)")
    page.click("#changeKey"); page.click("#forgetKey")
    check("forget clears storage", page.evaluate("localStorage.length") == 0 and len(stored) == 2, str(stored))
    ctx.close()

    # 2. remember off -> gone after reload
    ctx, page, log = setup_page(browser, en)
    page.goto(BASE); save_key(page, region="eastus", remember=False)
    page.wait_for_selector("body[data-state=idle]")
    page.reload(); page.wait_for_load_state()
    check("remember off: key gone after reload", page.is_visible("#setup") and page.evaluate("localStorage.length") == 0)
    ctx.close()

    # 3. es-ES: no prosody, no phoneme tooltip
    es = fixture("es-ES-continuous-21seg.json")
    ctx, page, log = setup_page(browser, es)
    page.goto(BASE); save_key(page, region="eastus")
    page.wait_for_selector("body[data-state=idle]")
    page.select_option("#locale", "es-ES")
    record(page, es["referenceText"], 2)
    page.wait_for_selector("body[data-state=results]", timeout=15000)
    labels = page.eval_on_selector_all(".bar dt", "els => els.map(e => e.textContent)")
    check("es-ES: prosody hidden", labels == ["Accuracy", "Fluency", "Completeness"], str(labels))
    check("es-ES: three counters, no pause marks", page.locator(".mark-toggle").count() == 3 and page.locator(".reading .pause").count() == 0)
    page.hover(".reading .word--correct >> nth=0")
    check("es-ES: tooltip without phonemes", page.query_selector("#tooltip .phonemes") is None)
    page.screenshot(path=f"{S}/shots/6-es.png", full_page=True)
    ctx.close()

    # 4. no speech
    ctx, page, log = setup_page(browser, {"segments": [{"RecognitionStatus": "Success", "NBest": [{"Lexical": ".", "PronunciationAssessment": {}}]}]})
    page.goto(BASE); save_key(page, region="eastus"); page.wait_for_selector("body[data-state=idle]")
    record(page, "Hello world.", 1)
    page.wait_for_selector("#error:not([hidden])", timeout=15000)
    check("no speech message", page.text_content("#errorMessage") == "No speech detected")
    ctx.close()

    # 5. invalid key at save
    ctx, page, log = setup_page(browser, en, token_status=401)
    page.goto(BASE); save_key(page, region="eastus")
    page.wait_for_function("document.querySelector('#keyMessage').textContent.length > 0")
    check("401 -> key or region rejected", "Key or region rejected" in page.text_content("#keyMessage"), page.text_content("#keyMessage"))
    page.select_option("#regionInput", ""); page.click("#saveKey")
    check("missing region asked for", "Choose the region" in page.text_content("#keyMessage"))
    ctx.close()

    # 6. microphone denied
    ctx = browser.new_context(permissions=[])
    page = ctx.new_page()
    page.route(SDK_PATH, lambda route: route.fulfill(status=200, content_type="application/javascript", body=f"window.__FIXTURE__={json.dumps(en)};\n{fake}"))
    page.route("https://*.api.cognitive.microsoft.com/**", lambda route: route.fulfill(status=200, body="t", headers={"Access-Control-Allow-Origin": "*"}))
    page.goto(BASE); save_key(page, region="eastus"); page.wait_for_selector("body[data-state=idle]")
    page.fill("#text", "Hello world.")
    page.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); }")
    page.click("#recordButton")
    page.wait_for_selector("#error:not([hidden])", timeout=10000)
    check("mic denied message", page.text_content("#errorMessage") == "No microphone access")
    ctx.close()

    # 7. real SDK, Azure unreachable from this sandbox -> connection error, worklet + SDK under CSP
    ctx, page, log = setup_page(browser, real_sdk=True)
    page.add_init_script("document.addEventListener('securitypolicyviolation', e => console.log('CSPV ' + e.effectiveDirective + ' ' + e.blockedURI))")
    page.add_init_script("{ const W = window.WebSocket; window.WebSocket = class extends W { constructor(u, p) { console.log('WSURL ' + u); super(u, p); } }; }")
    page.goto(BASE); save_key(page, region="eastus"); page.wait_for_selector("body[data-state=idle]")
    page.fill("#text", "Hello world.")
    page.click("#recordButton")
    page.wait_for_selector("#error:not([hidden])", timeout=40000)
    check("real SDK: unreachable Azure -> connection message", page.text_content("#errorMessage") == "Connection to Azure failed", page.text_content("#errorMessage"))
    sockets = [c[6:] for c in log["console"] if c.startswith("WSURL ")]
    check("real SDK: WebSocket carries token, not key", sockets and all("Authorization=" in u and KEY not in u for u in sockets), [re.sub(r"=[^&]*", "=…", u) for u in sockets[:1]])
    csp = [c for c in log["console"] if c.startswith("CSPV")]
    check("real SDK: no CSP violations", not csp, str(csp))
    ctx.close()

    # 7b. token older than 5 minutes (e.g. after sleep) is fetched again; bad stored region is dropped
    ctx, page, log = setup_page(browser, en)
    page.goto(BASE); save_key(page, region="eastus"); page.wait_for_selector("body[data-state=idle]")
    page.evaluate("() => { const real = Date.now; Date.now = () => real() + 6 * 60_000; }")
    record(page, "Hello world.", 1)
    page.wait_for_selector("body[data-state=results], #error:not([hidden])", timeout=15000)
    check("token refreshed after 5 minutes of wall time", sum("issueToken" in u for u in log["requests"]) == 2, str(sum("issueToken" in u for u in log["requests"])))
    page.evaluate("() => localStorage.setItem('pronunciation-coach.region', 'x.evil.com#')")
    page.reload(); page.wait_for_selector("#setup:not([hidden])", timeout=5000)
    check("unknown stored region sends the user to key setup and clears storage", page.evaluate("localStorage.length") == 0)
    ctx.close()

    # 8. mobile -> notice
    ctx = browser.new_context(**p.devices["iPhone 13"]); page = ctx.new_page(); page.goto(BASE)
    check("mobile shows desktop-only notice", page.is_visible("#unsupported") and not page.is_visible("#practice"))
    page.screenshot(path=f"{S}/shots/7-mobile.png", full_page=True)
    ctx.close()
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
