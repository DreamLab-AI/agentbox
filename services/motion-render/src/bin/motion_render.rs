//! `motion-render`: freeze an HTML page at exact times in the browser sidecar and write
//! frames, then encode.
//!
//! Contract with the page: it exposes `window.renderAt(t)` (and/or CSS/WAAPI animations),
//! and optionally `window.__ready`, `window.W/H/FPS/DUR` and `window.probe(t)`.

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use clap::Parser;
use motion_render::cdp::{self, Client};
use motion_render::diff::{compare_png, Verdict};
use motion_render::serve::FileServer;
use motion_render::{lock, plan};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

#[derive(Parser, Debug)]
#[command(name = "motion-render", version, about = "Render an HTML motion film frame-exact in the browser sidecar", long_about = None)]
struct Args {
    /// The film's HTML page.
    page: PathBuf,
    /// Output directory [default: <page dir>/../out].
    #[arg(long)]
    out: Option<PathBuf>,
    /// Directory served to the browser [default: the page's own directory].
    #[arg(long)]
    root: Option<PathBuf>,
    /// Width in CSS pixels [default: window.W, else 1080].
    #[arg(long)]
    w: Option<u32>,
    /// Height in CSS pixels [default: window.H, else 1920].
    #[arg(long)]
    h: Option<u32>,
    /// Frames per second [default: window.FPS, else 30; a draft is always 30].
    #[arg(long)]
    fps: Option<f64>,
    /// Duration in seconds [default: window.DUR, else 5].
    #[arg(long)]
    dur: Option<f64>,
    /// Motion blur sub-frames per frame (180 degree shutter).
    #[arg(long, default_value_t = 1)]
    sub: u32,
    /// Supersample factor; scaled back down on encode.
    #[arg(long, default_value_t = 1.0)]
    scale: f64,
    /// Half size, one sub-frame, 30 fps animatic.
    #[arg(long)]
    draft: bool,
    /// Transparent PNGs and a ProRes 4444 picture_alpha.mov.
    #[arg(long)]
    alpha: bool,
    /// Write PNG stills at these seconds (comma separated) and stop.
    #[arg(long, value_delimiter = ',')]
    stills: Option<Vec<f64>>,
    /// Determinism check: eight frames, revisited out of order, must match.
    #[arg(long)]
    verify: bool,
    /// Sample window.probe(t) per frame into qc/probe.json and qc/probe.png.
    #[arg(long)]
    probe: bool,
    /// Re-render from this second.
    #[arg(long)]
    from: Option<f64>,
    /// Re-render up to this second.
    #[arg(long)]
    to: Option<f64>,
    /// Write frames only.
    #[arg(long)]
    no_encode: bool,
}

const SEEK: &str = r#"async (t) => {
  if (typeof window.renderAt === 'function') await window.renderAt(t);
  document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; });
  return Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    new Promise((r) => setTimeout(() => r(false), 10000)),
  ]);
}"#;

const READY: &str = r#"async () => {
  await document.fonts.ready;
  const t0 = Date.now();
  while (!(window.__ready === undefined || window.__ready === true)) {
    if (Date.now() - t0 > 45000) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}"#;

/// One page in the run's private browser context.
struct Page {
    target: String,
    session: String,
}

struct Browser {
    client: Client,
    context: String,
    page_error: bool,
}

impl Browser {
    /// A foreground window of its own: a background tab gets no animation frames, and a seek
    /// waits on two of them.
    fn open_target(&mut self, w: u32, h: u32, scale: f64, transparent: bool) -> Result<Page> {
        let r = self.client.send(
            "Target.createTarget",
            json!({ "url": "about:blank", "browserContextId": self.context, "newWindow": true, "width": w.min(1920), "height": h.min(1080) }),
            None,
        )?;
        let target = r["targetId"].as_str().ok_or_else(|| anyhow!("no targetId"))?.to_owned();
        let r = self.client.send("Target.attachToTarget", json!({ "targetId": target, "flatten": true }), None)?;
        let session = r["sessionId"].as_str().ok_or_else(|| anyhow!("no sessionId"))?.to_owned();
        let s = Some(session.as_str());
        for domain in ["Page.enable", "Runtime.enable", "Network.enable"] {
            self.client.send(domain, json!({}), s)?;
        }
        self.client.send("Emulation.setDeviceMetricsOverride", json!({ "width": w, "height": h, "deviceScaleFactor": scale, "mobile": false }), s)?;
        self.client.send("Emulation.setFocusEmulationEnabled", json!({ "enabled": true }), s)?;
        if transparent {
            self.client.send("Emulation.setDefaultBackgroundColorOverride", json!({ "color": { "r": 0, "g": 0, "b": 0, "a": 0 } }), s)?;
        }
        Ok(Page { target, session })
    }

    fn close_target(&mut self, page: &Page) {
        let _ = self.client.send("Target.closeTarget", json!({ "targetId": page.target }), None);
    }

    /// Report page errors as they arrive; returns network activity for the idle wait.
    fn digest(&mut self, session: &str, inflight: &mut i64, loaded: &mut bool, failed: &mut Option<String>) -> bool {
        let mut activity = false;
        for e in self.client.drain() {
            if e.session.as_deref() != Some(session) {
                continue;
            }
            match e.method.as_str() {
                // A redirect reuses its request, so it is not a second one in flight.
                "Network.requestWillBeSent" => {
                    if e.params.get("redirectResponse").is_none() {
                        *inflight += 1;
                    }
                    activity = true;
                }
                "Network.loadingFinished" => {
                    *inflight = (*inflight - 1).max(0);
                    activity = true;
                }
                "Network.loadingFailed" => {
                    *inflight = (*inflight - 1).max(0);
                    activity = true;
                    if e.params["type"] == "Document" {
                        *failed = Some(e.params["errorText"].as_str().unwrap_or("failed").to_owned());
                    }
                }
                "Page.loadEventFired" => *loaded = true,
                "Runtime.exceptionThrown" => {
                    let d = &e.params["exceptionDetails"];
                    eprintln!("PAGE ERROR: {}", d["exception"]["description"].as_str().or_else(|| d["text"].as_str()).unwrap_or("exception"));
                    self.page_error = true;
                }
                "Runtime.consoleAPICalled" if e.params["type"] == "error" => {
                    let text: Vec<String> = e.params["args"].as_array().into_iter().flatten()
                        .map(|a| a["value"].as_str().map(str::to_owned).or_else(|| a["description"].as_str().map(str::to_owned)).unwrap_or_else(|| a["value"].to_string()))
                        .collect();
                    eprintln!("console: {}", text.join(" "));
                }
                _ => {}
            }
        }
        activity
    }

    /// Load the film and wait until it is idle, its fonts are in and it says it is ready.
    fn open_page(&mut self, url: &str, w: u32, h: u32, scale: f64, transparent: bool, local: &str) -> Result<Page> {
        let page = self.open_target(w, h, scale, transparent)?;
        let s = page.session.clone();
        let nav = self.client.send("Page.navigate", json!({ "url": format!("{url}?render=1&w={w}&h={h}") }), Some(&s))?;
        if let Some(err) = nav["errorText"].as_str() {
            bail!("the sidecar could not load the page from this container ({err}). It must reach {local} on the shared docker network.");
        }
        let (mut inflight, mut loaded, mut failed) = (0i64, false, None);
        let (t0, mut last) = (Instant::now(), Instant::now());
        loop {
            self.client.pump(Duration::from_millis(50))?;
            if self.digest(&s, &mut inflight, &mut loaded, &mut failed) {
                last = Instant::now();
            }
            if let Some(err) = &failed {
                bail!("page load failed: {err}");
            }
            if loaded && inflight == 0 && last.elapsed() > Duration::from_millis(500) {
                break;
            }
            if t0.elapsed() > Duration::from_secs(30) {
                if !loaded {
                    bail!("page did not finish loading in 30 s");
                }
                break;
            }
        }
        if self.client.evaluate(&s, READY, &Value::Null)? != Value::Bool(true) {
            bail!("window.__ready did not become true in 45 s");
        }
        Ok(page)
    }

    /// Seek, then wait two animation frames so compositor layers settle. A window that is not
    /// being drawn never delivers them: that is reported, never papered over with a timer,
    /// because a frame captured before the compositor caught up is a wrong frame that looks right.
    fn seek(&mut self, page: &Page, t: f64) -> Result<()> {
        if self.client.evaluate(&page.session, SEEK, &json!(t))? != Value::Bool(true) {
            bail!("no animation frame within 10 s at t={t}: the sidecar is not drawing the render window (minimised, or the display is down). Check it over VNC.");
        }
        let (mut a, mut b, mut c) = (0, false, None);
        self.digest(&page.session, &mut a, &mut b, &mut c);
        Ok(())
    }

    fn screenshot(&mut self, page: &Page) -> Result<Vec<u8>> {
        let r = self.client.send("Page.captureScreenshot", json!({ "format": "png", "optimizeForSpeed": true }), Some(&page.session))?;
        let data = r["data"].as_str().ok_or_else(|| anyhow!("screenshot returned no data"))?;
        base64::engine::general_purpose::STANDARD.decode(data).context("screenshot is not base64")
    }

    fn snap(&mut self, page: &Page, t: f64) -> Result<Vec<u8>> {
        self.seek(page, t)?;
        self.screenshot(page)
    }

    fn finish(&mut self) {
        let _ = self.client.send("Target.disposeBrowserContext", json!({ "browserContextId": self.context }), None);
        self.client.close();
    }
}

fn ffmpeg(args: &[String]) -> Result<()> {
    let status = Command::new("ffmpeg").args(["-y", "-loglevel", "error"]).args(args).status().context("cannot run ffmpeg")?;
    if !status.success() {
        bail!("ffmpeg failed");
    }
    Ok(())
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn esc(x: &str) -> String {
    x.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn probe_svg(rows: &[Value], keys: &[String], n: u64) -> (String, u32, u32) {
    const COLORS: [&str; 5] = ["#d9534f", "#2a7ae2", "#2e9e5b", "#c98a00", "#8a4fd1"];
    let (pw, ph) = (1600u32, 300 * keys.len() as u32);
    let mut svg = String::new();
    for (j, k) in keys.iter().enumerate() {
        // null = the element is off screen at that frame
        let v: Vec<Option<f64>> = rows.iter().map(|r| r[k].as_f64().filter(|y| y.is_finite())).collect();
        let ok: Vec<f64> = v.iter().flatten().copied().collect();
        let lo = ok.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = ok.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let (lo, hi) = if ok.is_empty() { (0.0, 0.0) } else { (lo, hi) };
        let span = if hi - lo == 0.0 { 1.0 } else { hi - lo };
        let x = |i: usize| 60.0 + i as f64 * (pw as f64 - 80.0) / (n.max(2) - 1) as f64;
        let y = |val: f64| j as f64 * 300.0 + 260.0 - (val - lo) / span * 220.0;
        let pts: Vec<String> = v.iter().enumerate().filter_map(|(i, o)| o.map(|val| format!("{:.1},{:.1}", x(i), y(val)))).collect();
        let dots: String = v.iter().enumerate().filter_map(|(i, o)| o.map(|val| format!("<circle cx=\"{:.1}\" cy=\"{:.1}\" r=\"2\"/>", x(i), y(val)))).collect();
        let c = COLORS[j % 5];
        svg.push_str(&format!(
            "<text x=\"10\" y=\"{}\" font-size=\"20\" fill=\"#222\">{}  [{:.3} .. {:.3}]</text><polyline fill=\"none\" stroke=\"{c}\" stroke-width=\"2\" points=\"{}\"/><g fill=\"{c}\">{dots}</g>",
            j * 300 + 24, esc(k), lo, hi, pts.join(" ")
        ));
    }
    (format!("<body style=\"margin:0;background:#fff;font-family:sans-serif\"><svg width=\"{pw}\" height=\"{ph}\">{svg}</svg></body>"), pw, ph)
}

fn run(args: &Args) -> Result<bool> {
    let page_path = fs::canonicalize(&args.page).with_context(|| format!("no such page: {}", args.page.display()))?;
    let page_dir = page_path.parent().ok_or_else(|| anyhow!("the page has no directory"))?.to_path_buf();
    let root = fs::canonicalize(args.root.clone().unwrap_or_else(|| page_dir.clone())).context("no such --root")?;
    let relative = page_path.strip_prefix(&root).map_err(|_| anyhow!("--root {} does not contain {}", root.display(), page_path.display()))?.to_path_buf();
    let out = args.out.clone().unwrap_or_else(|| page_dir.join("..").join("out"));
    if args.sub == 0 || args.scale.is_nan() || args.scale <= 0.0 {
        bail!("--sub and --scale must be positive");
    }

    let _guard = lock::acquire(&lock::default_path())?;

    let host = std::env::var("BROWSER_CDP_HOST").unwrap_or_else(|_| "browsercontainer".into());
    let port: u16 = std::env::var("BROWSER_CDP_PORT").ok().map(|p| p.parse().context("BROWSER_CDP_PORT is not a port")).transpose()?.unwrap_or(9223);
    let ep = cdp::discover(&host, port).map_err(|e| anyhow!("{e:#}. Start the sidecar from the host: ./agentbox.sh browsercontainer up"))?;
    let server = FileServer::start(&root, ep.local_ip)?;
    let url = server.url_for(&relative);
    let local = ep.local_ip.to_string();

    let mut client = Client::connect(&ep)?;
    let context = client.send("Target.createBrowserContext", json!({ "disposeOnDetach": true }), None)?["browserContextId"]
        .as_str().ok_or_else(|| anyhow!("no browserContextId"))?.to_owned();
    let mut br = Browser { client, context, page_error: false };
    let result = render(args, &mut br, &url, &local, &out);
    br.finish();
    drop(server);
    result?;
    Ok(!br.page_error)
}

fn render(args: &Args, br: &mut Browser, url: &str, local: &str, out: &Path) -> Result<()> {
    // First load at a probe size to read the page's own W/H/FPS/DUR.
    let first = br.open_page(url, args.w.unwrap_or(1080), args.h.unwrap_or(1920), args.scale, args.alpha, local)?;
    let meta = br.client.evaluate(&first.session, "() => ({ W: window.W, H: window.H, FPS: window.FPS, DUR: window.DUR })", &Value::Null)?;
    br.close_target(&first);
    let num = |k: &str| meta[k].as_f64().filter(|v| v.is_finite() && *v > 0.0);
    let w = args.w.or(num("W").map(|v| v as u32)).unwrap_or(1080);
    let h = args.h.or(num("H").map(|v| v as u32)).unwrap_or(1920);
    let fps = args.fps.unwrap_or(if args.draft { 30.0 } else { num("FPS").unwrap_or(30.0) });
    let dur = args.dur.or(num("DUR")).unwrap_or(5.0);
    if fps.is_nan() || dur.is_nan() || fps <= 0.0 || dur <= 0.0 {
        bail!("--fps and --dur must be positive");
    }
    let (ow, oh) = plan::output_size(w, h, args.draft);
    let n = plan::frame_count(dur, fps);
    let page = br.open_page(url, w, h, args.scale, args.alpha, local)?;

    // ---------- stills ----------
    if let Some(times) = &args.stills {
        let dir = out.join("stills");
        fs::create_dir_all(&dir)?;
        for &sec in times {
            let f = (sec * fps).round().max(0.0) as u64;
            let p = dir.join(format!("t{sec:.2}_f{f:04}.png"));
            fs::write(&p, br.snap(&page, plan::frame_time(f, fps))?)?;
            println!("{}", p.display());
        }
        return Ok(());
    }

    // ---------- determinism ----------
    if args.verify {
        let times = plan::verify_times(n, fps);
        let mut first = Vec::new();
        for &t in &times {
            first.push(br.snap(&page, t)?);
        }
        let (mut bad, mut noise) = (0, 0u64);
        for k in plan::verify_order() {
            let again = br.snap(&page, times[k])?;
            if again == first[k] {
                continue;
            }
            let d = compare_png(&first[k], &again)?;
            match d.verdict() {
                Verdict::Same => {}
                Verdict::Noise => noise += d.pixels,
                Verdict::Mismatch => {
                    bad += 1;
                    eprintln!("mismatch at t={:.3} (frame {}): {} px differ, max {}/255", times[k], (times[k] * fps).round(), d.pixels, d.max);
                }
            }
        }
        if bad > 0 {
            println!("verify FAILED ({bad}/{})", times.len());
            bail!("the page is not a pure function of time");
        }
        println!("{}", if noise > 0 { format!("verify OK ({noise} px anti-aliasing noise)") } else { "verify OK".into() });
        return Ok(());
    }

    // ---------- probe (speed graph) ----------
    if args.probe {
        let dir = out.join("qc");
        fs::create_dir_all(&dir)?;
        let mut rows = Vec::new();
        for i in 0..n {
            let mut row = br.client.evaluate(&page.session, "(t) => (window.probe ? window.probe(t) : {})", &json!(plan::frame_time(i, fps)))?;
            if !row.is_object() {
                row = json!({});
            }
            row["f"] = json!(i);
            rows.push(row);
        }
        let keys: Vec<String> = rows.first().and_then(Value::as_object).map(|o| o.keys().filter(|k| *k != "f").cloned().collect()).unwrap_or_default();
        if keys.is_empty() {
            bail!("the page defines no window.probe(t), or it returned no values");
        }
        fs::write(dir.join("probe.json"), serde_json::to_string(&rows)?)?;
        let (html, pw, ph) = probe_svg(&rows, &keys, n);
        let chart = br.open_target(pw, ph, 1.0, false)?;
        let tree = br.client.send("Page.getFrameTree", json!({}), Some(&chart.session))?;
        br.client.send("Page.setDocumentContent", json!({ "frameId": tree["frameTree"]["frame"]["id"], "html": html }), Some(&chart.session))?;
        br.client.evaluate(&chart.session, "() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))", &Value::Null)?;
        fs::write(dir.join("probe.png"), br.screenshot(&chart)?)?;
        println!("{}", dir.join("probe.json").display());
        println!("{}", dir.join("probe.png").display());
        return Ok(());
    }

    // ---------- frames ----------
    let frames = out.join(if args.draft { "frames_draft" } else { "frames" });
    let (from, to) = plan::frame_range(args.from, args.to, fps, n);
    if args.from.is_none() && frames.exists() {
        fs::remove_dir_all(&frames)?;
    }
    fs::create_dir_all(&frames)?;
    let sub_dir = out.join("_sub");
    let blur = args.sub > 1 && !args.draft;
    if blur {
        let _ = fs::remove_dir_all(&sub_dir);
        fs::create_dir_all(&sub_dir)?;
    }
    let t0 = Instant::now();
    for i in from..to {
        if blur {
            for k in 0..args.sub {
                let png = br.snap(&page, plan::sub_time(i, k, args.sub, fps))?;
                fs::write(sub_dir.join(format!("{:07}.png", plan::sub_index(i, from, k, args.sub))), png)?;
            }
        } else {
            fs::write(frames.join(format!("{i:05}.png")), br.snap(&page, plan::frame_time(i, fps))?)?;
        }
        if (i - from) % 30 == 29 {
            print!("\r{}/{to} frames", i + 1);
            let _ = std::io::stdout().flush();
        }
    }
    br.finish(); // the browser is done; the rest is local
    if blur && to > from {
        // Average each frame's sub-frames in one pass over the whole range.
        ffmpeg(&[
            "-framerate".into(), "1".into(), "-i".into(), s(&sub_dir.join("%07d.png")),
            "-vf".into(), format!("tmix=frames={0},select='eq(mod(n\\,{0})\\,{1})'", args.sub, args.sub - 1),
            "-fps_mode".into(), "passthrough".into(), "-start_number".into(), from.to_string(), s(&frames.join("%05d.png")),
        ])?;
    }
    let _ = fs::remove_dir_all(&sub_dir);
    println!("\n{} frames in {:.1} s -> {}", to - from, t0.elapsed().as_secs_f64(), frames.display());

    // ---------- encode ----------
    if !args.no_encode {
        let scale = format!("scale={ow}:{oh}:flags=lanczos");
        let input = [String::from("-framerate"), fps.to_string(), "-i".into(), s(&frames.join("%05d.png")), "-vf".into(), scale];
        let (file, codec): (&str, &[&str]) = if args.alpha {
            ("picture_alpha.mov", &["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"])
        } else {
            (if args.draft { "animatic.mp4" } else { "picture.mp4" }, &["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"])
        };
        let target = out.join(file);
        let mut a: Vec<String> = input.to_vec();
        a.extend(codec.iter().map(|x| x.to_string()));
        a.push(s(&target));
        ffmpeg(&a)?;
        println!("{}", target.display());
    }
    Ok(())
}

fn main() {
    let args = Args::parse();
    match run(&args) {
        Ok(true) => {}
        Ok(false) => std::process::exit(1), // the page threw while rendering
        Err(e) => {
            eprintln!("render failed: {e:#}");
            std::process::exit(1);
        }
    }
}
