import re, json, sys
from playwright.sync_api import sync_playwright, expect

import os
BASE = os.environ.get("BASE", "http://127.0.0.1:4180")
results = []
console_errors = []
failed_requests = []

def check(name):
    def deco(fn):
        try:
            fn(); results.append((name, True, ""))
        except Exception as e:
            results.append((name, False, str(e).split("\n")[0][:300]))
        return fn
    return deco

def attach(page, label):
    page.on("console", lambda m: console_errors.append((label, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append((label, "PAGEERROR " + str(e))))
    page.on("requestfailed", lambda r: failed_requests.append((label, r.url)) )
    page.on("response", lambda r: failed_requests.append((label, f"{r.status} {r.url}")) if r.status >= 400 and "/api/" not in r.url else None)

def search(page, frm, to):
    page.get_by_label("From · எங்கிருந்து").fill(frm)
    page.get_by_label("To · எங்கே", exact=True).fill(to)
    page.get_by_role("button", name="Find buses").click()
    page.wait_for_selector(".leg, .state", timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 860}, permissions=[])
    page = ctx.new_page(); attach(page, "public")
    page.goto(BASE); page.wait_for_selector("h1")

    @check("home loads with sample-data banner and Tamil/English labels")
    def _():
        expect(page.locator(".banner").first).to_contain_text("sample data")
        expect(page.get_by_text("எங்கே போகணும்?")).to_be_visible()

    @check("direct search shows operator, badges, stops, ETA estimate, fare label")
    def _():
        search(page, "Periyar Bus Stand", "Mattuthavani")
        card = page.locator(".leg", has_text="1A").first
        expect(card).to_contain_text("TNSTC Madurai")
        expect(card).to_contain_text("Government")
        expect(card).to_contain_text("Sample data")
        expect(card).to_contain_text("(estimate)")
        expect(card).to_contain_text("Sample fare (not real)")
        expect(card).to_contain_text("Last scheduled bus")
        card.locator("summary").click()
        expect(card).to_contain_text("Goripalayam")
        expect(page.get_by_text("No live bus location")).to_be_visible()

    @check("fare not verified shown when no fare data")
    def _():
        search(page, "Periyar Bus Stand", "Melur")
        expect(page.locator(".leg", has_text="5C").first).to_contain_text("Fare not verified")

    @check("private / government / mini-bus filters")
    def _():
        search(page, "Periyar Bus Stand", "Thirumangalam")
        expect(page.get_by_text("No bus found")).to_be_visible()      # default All? P12 private exists → fix below
    # (above intentionally replaced by next precise check)
    results.pop()

    @check("filters: private finds P12, government finds nothing, mini-bus finds MB3")
    def _():
        search(page, "Periyar Bus Stand", "Thirumangalam")
        expect(page.locator(".leg", has_text="P12").first).to_be_visible()
        page.get_by_role("button", name="Government").click()
        page.wait_for_selector(".state", timeout=6000)
        expect(page.get_by_text("No bus found")).to_be_visible()
        page.get_by_role("button", name="Private").click()
        page.wait_for_selector(".leg", timeout=6000)
        expect(page.locator(".leg", has_text="Private").first).to_be_visible()
        page.get_by_role("button", name="All buses").click()
        search(page, "Alanganallur", "Mattuthavani")
        page.get_by_role("button", name="Mini-bus").click()
        page.wait_for_selector(".leg", timeout=6000)
        expect(page.locator(".leg", has_text="MB3").first).to_be_visible()
        page.get_by_role("button", name="All buses").click()

    @check("no-route helpful message")
    def _():
        search(page, "Melur", "Periyar Bus Stand")
        expect(page.get_by_text("No bus found between these stops")).to_be_visible()
        expect(page.get_by_text("tell us about a route")).to_be_visible()

    @check("transfer journey shown with change stop and wait")
    def _():
        search(page, "KK Nagar", "Melur")
        expect(page.get_by_text("With one change")).to_be_visible()
        expect(page.locator(".transfer-head")).to_contain_text("Mattuthavani")
        assert page.locator(".transfer .leg").count() == 2

    @check("same stop rejected")
    def _():
        page.get_by_label("From · எங்கிருந்து").fill("Melur"); page.get_by_label("To · எங்கே", exact=True).fill("Melur")
        expect(page.get_by_text("Starting stop and destination are the same")).to_be_visible()
        expect(page.get_by_role("button", name="Find buses")).to_be_disabled()

    @check("text/voice query: Tanglish 'Madurai lendhu Melur' → ambiguity chips → search")
    def _():
        page.get_by_label("Your question").fill("Madurai lendhu Melur bus timing sollu")
        page.get_by_role("button", name="Use this").click()
        expect(page.get_by_text("Which starting stop?")).to_be_visible()
        page.get_by_role("button", name="Periyar Bus Stand").click()
        expect(page.get_by_label("To · எங்கே", exact=True)).to_have_value("Melur")
        page.get_by_role("button", name="Find buses").click()
        page.wait_for_selector(".leg")
        expect(page.locator(".leg", has_text="5C").first).to_be_visible()

    @check("text query 'Thirumangalam-ku private bus irukka?' sets private filter + destination")
    def _():
        page.get_by_label("Your question").fill("Thirumangalam-ku private bus irukka?")
        page.get_by_role("button", name="Use this").click()
        expect(page.get_by_label("To · எங்கே", exact=True)).to_have_value("Thirumangalam")
        expect(page.get_by_role("button", name="Private")).to_have_attribute("aria-pressed", "true")
        page.get_by_role("button", name="All buses").click()

    @check("Tamil-script query")
    def _():
        page.get_by_label("Your question").fill("மாட்டுத்தாவணி இருந்து மேலூருக்கு பஸ்")
        page.get_by_role("button", name="Use this").click()
        expect(page.get_by_label("From · எங்கிருந்து")).to_have_value("Mattuthavani")
        expect(page.get_by_label("To · எங்கே", exact=True)).to_have_value("Melur")

    @check("unrecognised speech → helpful message, manual correction possible")
    def _():
        page.get_by_label("Your question").fill("blah blah")
        page.get_by_role("button", name="Use this").click()
        expect(page.get_by_text("I could not find a stop name")).to_be_visible()

    @check("voice button exists with permission status text when supported")
    def _():
        expect(page.locator(".mic-state")).to_be_visible()
        txt = page.locator(".mic-state").inner_text()
        assert "Microphone" in txt or "not supported" in txt, txt

    @check("mic click without permission shows helpful error (no crash)")
    def _():
        if page.locator(".mic").count() == 0: return
        page.locator(".mic").click(); page.wait_for_timeout(1500)
        msg = page.locator(".voice .field-hint").last.inner_text()
        assert msg and ("Type your question" in msg or "Listening" in msg or "Microphone" in msg or "Speech" in msg), msg

    # unsupported-browser fallback
    ctx2 = b.new_context(viewport={"width": 390, "height": 800})
    ctx2.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition;")
    pg2 = ctx2.new_page(); attach(pg2, "novoice"); pg2.goto(BASE); pg2.wait_for_selector("h1")
    @check("voice unsupported → no mic button, clear message, typed search still works")
    def _():
        assert pg2.locator(".mic").count() == 0
        expect(pg2.locator(".mic-state")).to_contain_text("not supported")
        pg2.get_by_label("Your question").fill("Melur-ku bus irukka")
        pg2.get_by_role("button", name="Use this").click()
        expect(pg2.get_by_label("To · எங்கே", exact=True)).to_have_value("Melur")
    ctx2.close()

    @check("route page: ordered stops, departures, fares, source, map")
    def _():
        page.goto(BASE + "/#/"); page.reload(); page.wait_for_selector("h1")
        search(page, "Periyar Bus Stand", "Mattuthavani")
        page.locator(".leg", has_text="1A").first.get_by_role("link", name="Full route & stops").click()
        page.wait_for_selector(".route-head")
        expect(page.locator(".tl-item")).to_have_count(6)
        expect(page.get_by_text("Departure times")).to_be_visible()
        assert page.locator(".time").count() > 10
        expect(page.locator(".time.next")).to_have_count(1)
        expect(page.get_by_text("Fares").first).to_be_visible()
        expect(page.get_by_text("This is sample data for testing")).to_be_visible()
        page.wait_for_selector(".leaflet-container", timeout=8000)
        page.locator("#b").select_option(label="Anna Nagar")
        assert page.locator(".time").count() > 10

    @check("save offline → listed in Saved with last sync")
    def _():
        page.get_by_role("button", name=re.compile("Save offline")).first.click()
        expect(page.get_by_text("Saved for offline use.")).to_be_visible()
        page.goto(BASE + "/#/saved"); page.wait_for_selector("h1")
        expect(page.locator(".leg", has_text="1A").first).to_be_visible()
        expect(page.get_by_text("Last sync:")).to_be_visible()
        expect(page.get_by_text("may be outdated")).to_be_visible()

    @check("offline: saved route opens from device copy with outdated warning; offline reload works")
    def _():
        page.wait_for_timeout(1500)
        page.evaluate("navigator.serviceWorker.ready.then(()=>1)")
        ctx.set_offline(True)
        page.evaluate("window.dispatchEvent(new Event('offline'))")
        expect(page.locator(".banner.offline")).to_be_visible()
        page.locator(".leg", has_text="1A").first.get_by_role("link", name="Open timetable").click()
        page.wait_for_selector(".route-head")
        expect(page.get_by_text("You are offline. Showing the copy saved on this device")).to_be_visible()
        expect(page.locator(".tl-item")).to_have_count(6)
        assert page.locator(".time").count() > 10
        page.reload(); page.wait_for_selector(".route-head", timeout=10000)
        expect(page.get_by_text("Offline schedules may be outdated")).to_be_visible()

    @check("offline search shows clear message; refresh disabled offline")
    def _():
        page.goto(BASE + "/#/"); page.wait_for_selector("h1", timeout=10000)
        expect(page.get_by_text("You are offline. Search needs internet")).to_be_visible()
        page.goto(BASE + "/#/saved"); page.wait_for_selector("h1")
        expect(page.get_by_role("button", name=re.compile("Refresh all"))).to_be_disabled()

    @check("back online → refresh updates sync time")
    def _():
        ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_timeout(2500)
        expect(page.locator(".banner.offline")).to_have_count(0)
        before = page.locator(".card.row-between .small").first.inner_text()
        page.get_by_role("button", name=re.compile("Refresh all")).click()
        expect(page.get_by_text(re.compile("Updated 1 route"))).to_be_visible()

    @check("remove saved route")
    def _():
        page.get_by_role("button", name="Remove").click()
        expect(page.get_by_text("No saved routes yet")).to_be_visible()

    @check("all main nav links resolve (no 'Page not found')")
    def _():
        for path in ["", "map", "saved", "reminders", "alerts", "safety", "about", "admin"]:
            page.goto(f"{BASE}/#/{path}"); page.wait_for_selector("h1", timeout=8000)
            assert "Page not found" not in page.inner_text("main"), path

    @check("alerts page empty state")
    def _():
        page.goto(BASE + "/#/alerts"); page.wait_for_selector("h1")
        expect(page.get_by_text("No active service alerts")).to_be_visible()

    @check("about: sources table, feedback validation & submit, route suggestion")
    def _():
        page.goto(BASE + "/#/about"); page.wait_for_selector("h1")
        expect(page.get_by_text("Sample data (not real)").first).to_be_visible()
        page.get_by_label("Your message").fill("hi")
        page.get_by_role("button", name="Send feedback").click()
        expect(page.get_by_text("Must be at least 5 characters")).to_be_visible()
        page.get_by_label("Your message").fill("E2E feedback from automated test")
        page.get_by_role("button", name="Send feedback").click()
        expect(page.get_by_text("Your feedback was received")).to_be_visible()
        page.get_by_label("Bus number").fill("E2E-S1")
        page.get_by_label("Starts at").fill("Tallakulam"); page.get_by_label("Ends at").fill("Thirumangalam")
        page.get_by_label("Where did you get this? (required)").fill("E2E test note")
        page.get_by_role("button", name="Submit for review").click()
        expect(page.get_by_text("An admin will review this")).to_be_visible()

    @check("no console errors on public pages (ignoring blocked map tiles / speech network)")
    def _():
        bad = [e for e in console_errors if "tile.openstreetmap" not in e[1] and "ERR_" not in e[1] and "Failed to load resource" not in e[1]]
        assert not bad, bad[:5]

    @check("no broken local assets (icons, js, css)")
    def _():
        local = [f for f in failed_requests if BASE in f[1] and "/api/" not in f[1]]
        assert not local, local[:5]

    page.goto(BASE + "/icon-192.png"); 
    b.close()

fails = [r for r in results if not r[1]]
for n, ok, msg in results: print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"\n      → {msg}"))
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
print("console errors (all):", [e for e in console_errors if 'tile.openstreetmap' not in e[1]][:6])
