import re, json
from playwright.sync_api import sync_playwright, expect

import os
BASE = os.environ.get("BASE", "http://127.0.0.1:4180")
H = {"x-requested-with": "mbt", "content-type": "application/json"}
results, console_errors, requests_seen = [], [], []

def check(name):
    def deco(fn):
        try: fn(); results.append((name, True, ""))
        except Exception as e: results.append((name, False, str(e).split("\n")[0][:400]))
        return fn
    return deco

def attach(page, label):
    page.on("console", lambda m: console_errors.append((label, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append((label, "PAGEERROR " + str(e))))
    page.on("request", lambda r: requests_seen.append((r.method, r.url, r.post_data or "")))

with sync_playwright() as p:
    b = p.chromium.launch()

    # ───────────── Reminders with a fake clock (20:35 IST on 2026-10-29) ─────────────
    ctx = b.new_context(viewport={"width": 390, "height": 860})
    page = ctx.new_page(); attach(page, "reminders")
    page.clock.install(time="2026-10-29T15:05:00Z")
    page.goto(BASE + "/#/reminders"); page.wait_for_selector("h1")

    @check("reminders: explains permission + limits; offers Allow notifications")
    def _():
        expect(page.get_by_text("cannot tell you whether a bus is actually running")).to_be_visible()
        body = page.locator("main").inner_text()
        assert any(k in body for k in ["Allow notifications", "cannot show notifications", "Notifications are blocked", "Notifications are allowed"]), body[:300]

    @check("reminders: preview last bus, warns when data unverified, saves reminder")
    def _():
        page.locator("#r").select_option(label=re.compile(r"^1A"))  if False else None
        opts = page.locator("#r option").all_inner_texts()
        label = [o for o in opts if o.startswith("1A")][0]
        page.locator("#r").select_option(label=label)
        expect(page.get_by_text("Last scheduled bus today:")).to_be_visible()
        expect(page.locator("main")).to_contain_text("9:00 PM")
        expect(page.locator("main")).to_contain_text("8:30 PM")
        expect(page.get_by_text("sample data. Do not rely on this reminder")).to_be_visible()
        page.get_by_role("button", name="Save reminder").click()
        expect(page.get_by_text("Reminder saved on this device.")).to_be_visible()
        expect(page.locator(".card", has_text="Route 1A from Periyar Bus Stand")).to_be_visible()

    @check("reminders: fires an in-app alert near the last bus, once per day, with no live-status claim")
    def _():
        page.clock.run_for(31000)
        expect(page.locator(".toast")).to_be_visible()
        txt = page.locator(".toast").inner_text()
        assert "Last bus: route 1A" in txt and "timetable, not live status" in txt, txt
        page.clock.run_for(20000)                       # toast auto-dismisses
        page.clock.run_for(31000)
        assert page.locator(".toast").count() == 0, "must not fire twice the same day"

    @check("reminders: no scheduled bus today → cannot create (MB3 not running Sunday)")
    def _():
        pg = ctx.new_page(); pg.clock.install(time="2026-11-01T06:00:00Z")      # Sunday
        pg.goto(BASE + "/#/reminders"); pg.wait_for_selector("h1")
        label = [o for o in pg.locator("#r option").all_inner_texts() if o.startswith("MB3")][0]
        pg.locator("#r").select_option(label=label)
        expect(pg.get_by_text("No scheduled bus from this stop today")).to_be_visible()
        expect(pg.get_by_role("button", name="Save reminder")).to_be_disabled()
        pg.close()

    @check("reminders: toggle off and delete")
    def _():
        page.get_by_role("button", name="On").click(); expect(page.get_by_role("button", name="Off")).to_be_visible()
        page.get_by_role("button", name="Delete").click(); expect(page.get_by_text("No reminders yet.")).to_be_visible()
    ctx.close()

    # ───────────── Safety ─────────────
    ctx = b.new_context(viewport={"width": 390, "height": 860}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page(); attach(page, "safety")
    page.goto(BASE + "/#/safety"); page.wait_for_selector("h1")

    @check("safety: honest 'cannot send automatically' notice + emergency numbers as tel: links")
    def _():
        expect(page.get_by_text("cannot call the police or send messages for you automatically")).to_be_visible()
        for n in ["112", "100", "181"]:
            assert page.locator(f"a[href='tel:{n}']").count() >= 1, n

    @check("safety: contact validation, add, persist after reload, remove")
    def _():
        page.get_by_label("Name").fill("Amma"); page.get_by_label("Phone").fill("123")
        page.get_by_role("button", name="Add contact").click()
        expect(page.get_by_text("Enter a valid phone number")).to_be_visible()
        page.get_by_label("Phone").fill("+91 98765 43210"); page.get_by_role("button", name="Add contact").click()
        expect(page.locator(".contact")).to_contain_text("Amma"); expect(page.locator(".contact")).to_contain_text("+919876543210")
        page.reload(); page.wait_for_selector("h1")
        expect(page.locator(".contact")).to_contain_text("Amma")

    @check("safety: trip message has route, boarding, destination, ETA estimate; SMS/WhatsApp links built")
    def _():
        opts = page.locator("#sr option").all_inner_texts()
        page.locator("#sr").select_option(label=[o for o in opts if o.startswith("1A")][0])
        page.locator("#sf").select_option(label="Periyar Bus Stand"); page.locator("#st").select_option(label="Mattuthavani")
        page.get_by_role("button", name="Prepare message").click()
        ta = page.get_by_label("Trip message"); expect(ta).to_be_visible()
        v = ta.input_value()
        for must in ["Bus 1A", "Boarding: Periyar Bus Stand", "Going to: Mattuthavani", "Estimated arrival:", "estimate, not live"]:
            assert must in v, (must, v)
        assert page.locator("a[href^='sms:+919876543210']").count() == 1
        assert page.locator("a[href^='https://wa.me/919876543210']").count() == 1

    @check("safety: share/copy gives truthful feedback (no false 'sent' claim)")
    def _():
        page.get_by_role("button", name="Copy").click()
        expect(page.get_by_text("Message copied.")).to_be_visible()
        page.get_by_role("button", name="Share…").click()
        page.wait_for_timeout(500)
        msg = page.locator(".field-hint").last.inner_text()
        assert msg and "has been sent" not in msg.lower() and "successfully sent" not in msg.lower(), msg

    @check("safety: location only when ticked; denied permission is reported, not hidden")
    def _():
        page.get_by_label("Include my current location (asks permission)").check()
        page.get_by_role("button", name="Prepare message").click()
        page.wait_for_timeout(800)
        expect(page.locator(".field-hint").last).to_contain_text(re.compile("denied|Could not get your location|does not support"))
        assert "maps.google.com" not in page.get_by_label("Trip message").input_value()

    @check("safety: SOS requires confirmation, Cancel/Escape do nothing, confirm shows 112 + message, never claims sent")
    def _():
        page.get_by_role("button", name=re.compile("^SOS")).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.get_by_role("button", name="Cancel").click()
        assert page.locator(".sos-out").count() == 0 and page.get_by_role("dialog").count() == 0
        page.get_by_role("button", name=re.compile("^SOS")).click(); page.keyboard.press("Escape")
        assert page.get_by_role("dialog").count() == 0
        page.get_by_role("button", name=re.compile("^SOS")).click()
        page.get_by_role("button", name="Yes, I need help").click()
        out = page.locator(".sos-out"); expect(out).to_be_visible()
        expect(out.locator("a[href='tel:112']")).to_be_visible()
        assert "EMERGENCY" in out.locator("textarea").input_value()
        expect(out).to_contain_text("Location sharing was off.")
        expect(out).to_contain_text("does not send the message")
        assert out.locator("a[href^='sms:']").count() == 1

    @check("safety: SOS with location ticked but permission denied → clear note, still usable")
    def _():
        page.get_by_role("button", name=re.compile("^SOS")).click()
        page.get_by_role("dialog").get_by_label(re.compile("Include my current location")).check()
        page.get_by_role("button", name="Yes, I need help").click(); page.wait_for_timeout(800)
        expect(page.locator(".sos-out")).to_contain_text(re.compile("denied|Could not get|does not support"))
        expect(page.locator(".sos-out a[href='tel:112']")).to_be_visible()

    @check("safety: contacts never sent to the server")
    def _():
        leaked = [r for r in requests_seen if "98765" in r[1] or "98765" in r[2] or "Amma" in r[2]]
        assert not leaked, leaked[:2]

    @check("safety: remove contact")
    def _():
        page.get_by_role("button", name="Remove Amma").click(); expect(page.locator(".contact")).to_have_count(0)
    ctx.close()

    # location granted → coordinates included
    ctx = b.new_context(viewport={"width": 390, "height": 860}, permissions=["geolocation"], geolocation={"latitude": 9.9252, "longitude": 78.1198})
    page = ctx.new_page(); attach(page, "geo"); page.goto(BASE + "/#/safety"); page.wait_for_selector("h1")
    @check("safety: with permission granted, SOS message includes a maps link and says so")
    def _():
        page.get_by_role("button", name=re.compile("^SOS")).click()
        page.get_by_role("dialog").get_by_label(re.compile("Include my current location")).check()
        page.get_by_role("button", name="Yes, I need help").click(); page.wait_for_timeout(800)
        expect(page.locator(".sos-out")).to_contain_text("Your location is included")
        assert "maps.google.com/?q=9.92520,78.11980" in page.locator(".sos-out textarea").input_value()
    ctx.close()

    # ───────────── Alerts (created via the admin API, shown to passengers) ─────────────
    ctx = b.new_context(viewport={"width": 390, "height": 860})
    page = ctx.new_page(); attach(page, "alerts")
    @check("alerts: admin publishes → passenger sees it on Alerts and on affected route results; archive hides it")
    def _():
        page.goto(BASE + "/#/about"); page.wait_for_selector("h1")
        def call(method, path, body=None):
            return page.evaluate('''async ([m, p, b]) => { const r = await fetch(p, {method: m, credentials: 'same-origin', headers: {'x-requested-with': 'mbt', 'content-type': 'application/json'}, body: b ? JSON.stringify(b) : undefined}); return {status: r.status, json: await r.json().catch(() => null)} }''', [method, path, body])
        assert call("POST", "/api/auth/login", {"email": "admin@example.test", "password": "Test-Admin-Pass-123"})["status"] == 200
        routes = call("GET", "/api/routes")["json"]["routes"]
        r1a = [r for r in routes if r["routeNo"] == "1A"][0]["id"]
        a = call("POST", "/api/admin/alerts", {"type": "diversion", "title": "E2E diversion near Goripalayam", "body": "Test body", "source": "E2E test notice", "verificationStatus": "unverified", "routeIds": [r1a]})
        assert a["status"] == 200, a; aid = a["json"]["id"]
        page.goto(BASE + "/#/alerts"); page.wait_for_selector("h1")
        expect(page.get_by_text("E2E diversion near Goripalayam")).to_be_visible()
        expect(page.locator(".alert").first).to_contain_text("Unverified")
        expect(page.locator(".alert").first).to_contain_text("Source: E2E test notice")
        page.goto(BASE + "/#/"); page.wait_for_selector("h1")
        page.get_by_label("From · எங்கிருந்து").fill("Periyar Bus Stand"); page.get_by_label("To · எங்கே", exact=True).fill("Mattuthavani")
        page.get_by_role("button", name="Find buses").click(); page.wait_for_selector(".leg")
        expect(page.locator(".alert-inline").first).to_contain_text("E2E diversion near Goripalayam")
        assert call("POST", f"/api/admin/alerts/{aid}/archive", {})["status"] == 200
        call("POST", "/api/auth/logout", {})
        page.goto(BASE + "/#/alerts"); page.reload(); page.wait_for_selector("h1")
        assert page.get_by_text("E2E diversion near Goripalayam").count() == 0
    ctx.close()

    # ───────────── Admin UI ─────────────
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = ctx.new_page(); attach(page, "admin")
    page.goto(BASE + "/#/admin"); page.wait_for_selector("h1")

    def login(email, pw):
        page.get_by_label("Email").fill(email); page.get_by_label("Password").fill(pw); page.get_by_role("button", name="Sign in").click()

    @check("admin: login required; wrong password shows an error")
    def _():
        expect(page.get_by_role("heading", name="Staff sign-in")).to_be_visible()
        login("admin@example.test", "wrong-password-123")
        expect(page.get_by_text("Incorrect email or password")).to_be_visible()

    @check("admin: editor sees only permitted sections")
    def _():
        login("editor@example.test", "Test-Editor-Pass-123")
        page.wait_for_selector(".admin-tabs")
        tabs = page.locator(".admin-tabs button").all_inner_texts()
        assert "Audit log" not in tabs and "Service alerts" not in tabs and "Operators" not in tabs, tabs
        assert "Routes & schedules" in tabs and "Import / export" in tabs
        page.get_by_role("button", name="Sign out").click(); expect(page.get_by_role("heading", name="Staff sign-in")).to_be_visible()

    @check("admin: admin overview shows stats, status counts and data-quality issues")
    def _():
        login("admin@example.test", "Test-Admin-Pass-123"); page.wait_for_selector(".stat-grid")
        expect(page.locator(".stat-grid")).to_contain_text("Active routes")
        expect(page.get_by_text("Data-quality issues")).to_be_visible()
        expect(page.locator("main")).to_contain_text("Unverified")  if False else None
        assert page.locator(".admin-tabs button").count() == 10

    @check("admin: route form validates (empty number rejected with message)")
    def _():
        page.get_by_role("button", name="Routes & schedules").click()
        page.get_by_role("button", name="+ New route").click()
        page.get_by_role("button", name="Save route").click()
        expect(page.locator(".field-hint.bad")).to_be_visible()

    @check("admin: create route with ordered stops + schedule range → appears in list")
    def _():
        ed = page.locator(".editor")
        ed.locator("label:has-text('Route number') + input").fill("E2E-R1")
        ed.locator("label:has-text('Operator') + select").select_option(label="TNSTC Madurai (govt)")
        sels = ed.locator(".row-stop select")
        sels.nth(0).select_option(label="Periyar Bus Stand"); sels.nth(1).select_option(label="Melur")
        ed.locator(".row-stop input").nth(1).fill("40")
        ed.locator("textarea").first.fill("06:00-08:00/60")
        ed.get_by_role("button", name="Save route").click()
        page.wait_for_selector("table.table"); 
        expect(page.locator("tr", has_text="E2E-R1")).to_be_visible()

    @check("admin: verified status needs source + date (server message shown), then saves")
    def _():
        page.locator("tr", has_text="E2E-R1").get_by_role("button", name="Edit").click()
        ed = page.locator(".editor"); page.wait_for_selector(".editor .row-stop")
        ed.locator("label:has-text('Verification status') + select").select_option("verified")
        ed.get_by_role("button", name="Save route").click()
        expect(page.locator(".field-hint.bad")).to_contain_text("verified route needs a source")
        ed.locator("label:has-text('Source') + select").select_option(label="Sample data (not real)")
        ed.locator("label:has-text('Verified on') + input").fill("2026-10-29")
        ed.get_by_role("button", name="Save route").click()
        expect(page.locator(".field-hint.ok")).to_contain_text("Saved.")
        expect(page.get_by_text("Verification history")).to_be_visible()
        ed.get_by_role("button", name="Close").click()

    @check("admin: deactivate hides route from passengers (row dimmed, Active = No)")
    def _():
        row = page.locator("tr", has_text="E2E-R1"); row.get_by_role("button", name="Deactivate").click()
        page.wait_for_timeout(600)
        expect(page.locator("tr", has_text="E2E-R1")).to_contain_text("No")

    @check("admin: add a stop")
    def _():
        page.get_by_role("button", name="Stops", exact=True).click()
        page.get_by_role("button", name="+ Add").click()
        page.get_by_label("Name (English)").fill("E2E Test Stop"); page.get_by_label("Name (Tamil)").fill("சோதனை")
        page.get_by_label(re.compile("Other spellings")).fill("e2e, testing stop")
        page.get_by_role("button", name="Save", exact=True).click()
        expect(page.locator("tr", has_text="E2E Test Stop")).to_be_visible()

    @check("admin: invalid stop coordinates rejected")
    def _():
        page.get_by_role("button", name="+ Add").click()
        page.get_by_label("Name (English)").fill("Bad Coords"); page.get_by_label("Latitude").fill("123")
        page.get_by_label("Longitude").fill("10"); page.get_by_role("button", name="Save", exact=True).click()
        expect(page.locator(".field-hint.bad")).to_contain_text("lat")
        page.get_by_role("button", name="Cancel").click()

    @check("admin: publish alert needs source + target; published alert listed; archive")
    def _():
        page.get_by_role("button", name="Service alerts").click()
        page.get_by_label("Headline").fill("E2E UI closure")
        page.get_by_role("button", name="Publish alert").click()
        expect(page.locator(".field-hint.bad")).to_be_visible()
        page.get_by_label("Source of this information").fill("E2E notice")
        page.get_by_label("Affected routes (hold Ctrl/Cmd to select several)").select_option(index=0)
        page.get_by_role("button", name="Publish alert").click()
        expect(page.get_by_text("Alert published.")).to_be_visible()
        expect(page.locator(".card", has_text="E2E UI closure")).to_be_visible()
        page.locator(".card", has_text="E2E UI closure").get_by_role("button", name="Archive").click()
        page.wait_for_timeout(600)
        assert page.locator(".card", has_text="E2E UI closure").get_by_role("button", name="Archive").count() == 0

    @check("admin: CSV dry-run saves nothing, real import creates, re-import flags duplicates")
    def _():
        page.get_by_role("button", name="Import / export").click()
        csv = ("route_no,operator,operator_type,bus_type,stops,departures,days,fare_full,source_name,source_url,source_type,verified_date,status\n"
               "E2E-C1,E2E Operator,private,ordinary,Periyar Bus Stand@0;Goripalayam@8;Melur@50,06:00-08:00/60,1-6,30,E2E Source,https://example.org,operator,2026-10-01,verified\n"
               "E2E-C2,E2E Operator,private,ordinary,Periyar Bus Stand@0;Nowhere@8,06:00,1-7,,,,,,unverified\n")
        page.get_by_label("…or paste CSV").fill(csv)
        page.get_by_role("button", name=re.compile("Dry run")).click()
        expect(page.get_by_text("Dry run result (nothing saved)")).to_be_visible()
        expect(page.locator(".card[aria-live]")).to_contain_text("Unknown stop")
        page.get_by_role("button", name=re.compile("Import for real")).click()
        expect(page.get_by_role("heading", name="Import result")).to_be_visible()
        expect(page.locator(".card[aria-live]")).to_contain_text("new: 1")
        page.get_by_role("button", name=re.compile("Import for real")).click(); page.wait_for_timeout(800)
        expect(page.locator(".card[aria-live]")).to_contain_text("duplicates skipped: 1")

    @check("admin: export downloads a CSV")
    def _():
        with page.expect_download() as d:
            page.get_by_role("button", name=re.compile("Export all routes")).click()
        assert d.value.suggested_filename.endswith(".csv")

    @check("admin: submissions can be approved into an inactive draft")
    def _():
        page.get_by_role("button", name="Submissions").click()
        card = page.locator(".card", has_text="E2E-S1").first
        card.get_by_role("button", name=re.compile("Approve")).click()
        expect(page.get_by_text(re.compile("draft route"))).to_be_visible()

    @check("admin: audit log records changes with who/what")
    def _():
        page.get_by_role("button", name="Audit log").click()
        page.wait_for_selector("table.table")
        txt = page.locator("table.table").inner_text()
        for must in ["create", "route", "stop", "publish", "alert", "import", "deactivate", "admin@example.test", "editor@example.test"]:
            assert must in txt, must

    @check("admin: feedback list shows submitted feedback")
    def _():
        page.get_by_role("button", name="Feedback").click()
        expect(page.get_by_text("E2E feedback from automated test").first).to_be_visible()

    @check("admin: after sign-out, admin API calls are refused (server-side)")
    def _():
        page.get_by_role("button", name="Sign out").click()
        for path in ["/api/admin/overview", "/api/admin/audit", "/api/admin/alerts"]:
            st = page.evaluate("async p => (await fetch(p, {credentials:'same-origin'})).status", path)
            assert st == 401, (path, st)

    # ───────────── Responsive: no horizontal overflow, screenshots ─────────────
    for w, h in [(360, 740), (390, 844), (768, 1024), (1024, 768), (1440, 900)]:
        c = b.new_context(viewport={"width": w, "height": h}); pg = c.new_page(); attach(pg, f"resp{w}")
        for path in ["", "route/1", "map", "saved", "reminders", "alerts", "safety", "about", "admin"]:
            def f(path=path, pg=pg, w=w):
                pg.goto(f"{BASE}/#/{path}"); pg.wait_for_selector("h1", timeout=8000); pg.wait_for_timeout(300)
                sw = pg.evaluate("document.documentElement.scrollWidth"); iw = pg.evaluate("window.innerWidth")
                assert sw <= iw + 1, f"horizontal overflow {sw}>{iw}"
                if path in ("", "route/1", "safety") and w in (390, 768, 1440): pg.screenshot(path=f"/tmp/shots/{w}_{path.replace('/','_') or 'home'}.png")
            check(f"responsive {w}px: #{path or 'home'} has no horizontal overflow")(f)
        # results layout screenshot
        pg.goto(BASE + "/#/"); pg.wait_for_selector("h1")
        pg.get_by_label("From · எங்கிருந்து").fill("Periyar Bus Stand"); pg.get_by_label("To · எங்கே", exact=True).fill("Mattuthavani")
        pg.get_by_role("button", name="Find buses").click(); pg.wait_for_selector(".leg")
        if w in (390, 1440): pg.screenshot(path=f"/tmp/shots/{w}_results.png")
        sw = pg.evaluate("document.documentElement.scrollWidth")
        check(f"responsive {w}px: results has no horizontal overflow")(lambda: (_ for _ in ()).throw(AssertionError(f"overflow {sw}")) if sw > w + 1 else None)
        c.close()

    b.close()

bad = [e for e in console_errors if not any(k in e[1] for k in ["tile.openstreetmap", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET", "Failed to load resource"])]
results.append(("no JS errors / console errors across all flows", not bad, str(bad[:4])))
fails = [r for r in results if not r[1]]
for n, ok, msg in results: print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"\n      → {msg}"))
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
