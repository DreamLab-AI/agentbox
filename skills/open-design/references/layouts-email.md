# Email Template Layouts

HTML email skeletons for marketing and transactional mail. Email clients are a
hostile rendering target: no external stylesheets, no flexbox/grid you can trust,
no web fonts you can rely on. Compose from tables, inline every style, and cap the
body at 600px.

---

## Structure

```html
<body style="margin:0;padding:0;background:#f4f4f5;">
  <!-- preheader: hidden inbox-preview text -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    [PREHEADER — one specific line, under 90 chars]
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="width:600px;max-width:600px;background:#ffffff;">
        <!-- header / hero / body / cta / footer rows go here -->
      </table>
    </td></tr>
  </table>
</body>
```

**Email hard constraints (differ from web/deck):**
- **Tables for layout**, not `<div>` + flex/grid — Outlook ignores modern CSS.
- **Inline every style** on the element; `<style>` blocks are stripped or unreliable.
  This is the one place the "no raw hex outside `:root`" rule is inverted — resolve
  DESIGN.md tokens to literal hex at author time and inline them.
- **600px max body width**; single column below ~480px.
- **System font stack only** (`-apple-system, "Segoe UI", Roboto, Arial, sans-serif`);
  brand web fonts do not load in most clients — pick the closest system fallback.
- **No background images as the only carrier of meaning** — Outlook drops them.
- **Bulletproof buttons** — a styled `<a>` inside a table cell, not a `<button>`.

---

## Header

```html
<tr>
  <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
    <img src="[LOGO_URL]" width="120" alt="[BRAND]"
         style="display:block;border:0;height:auto;">
  </td>
</tr>
```

---

## Hero

```html
<tr>
  <td style="padding:40px 32px 8px;">
    <h1 style="margin:0;font-family:Arial,sans-serif;font-size:26px;
               line-height:1.25;color:#18181b;font-weight:700;">
      [HEADLINE — under 12 words, specific]
    </h1>
    <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:16px;
              line-height:1.55;color:#52525b;">
      [SUBHEAD — one sentence of concrete context]
    </p>
  </td>
</tr>
```

---

## Body

```html
<tr>
  <td style="padding:16px 32px;font-family:Arial,sans-serif;font-size:16px;
             line-height:1.6;color:#3f3f46;">
    <p style="margin:0 0 16px;">[PARAGRAPH — real, specific content]</p>
    <p style="margin:0 0 16px;">[PARAGRAPH — one idea per block]</p>
  </td>
</tr>
```

---

## CTA (bulletproof button)

```html
<tr>
  <td style="padding:16px 32px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" bgcolor="[ACCENT_HEX]"
            style="border-radius:6px;">
          <a href="[URL]"
             style="display:inline-block;padding:14px 28px;
                    font-family:Arial,sans-serif;font-size:16px;font-weight:600;
                    color:#ffffff;text-decoration:none;border-radius:6px;">
            [OUTCOME LABEL — "Start free", not "Click here"]
          </a>
        </td>
      </tr>
    </table>
  </td>
</tr>
```

---

## Footer

```html
<tr>
  <td style="padding:24px 32px;border-top:1px solid #e4e4e7;
             font-family:Arial,sans-serif;font-size:13px;line-height:1.5;
             color:#a1a1aa;">
    <p style="margin:0 0 8px;">[COMPANY NAME], [POSTAL ADDRESS]</p>
    <p style="margin:0;">
      <a href="[UNSUB_URL]" style="color:#a1a1aa;text-decoration:underline;">
        Unsubscribe
      </a> · <a href="[PREFS_URL]" style="color:#a1a1aa;text-decoration:underline;">
        Update preferences
      </a>
    </p>
  </td>
</tr>
```

---

## Hard Rules (Email)

- **Physical postal address + working unsubscribe** in the footer — legally required
  (CAN-SPAM / UK PECR) for marketing mail, not optional.
- **Preheader text** is mandatory — the hidden line the inbox shows after the subject;
  make it specific, never a duplicate of the headline.
- **Alt text on every image** — many clients block images by default; the mail must
  read with images off.
- **Accent used once** — the CTA button. No second accent-coloured element competing
  with it.
- **No emoji as icons, no invented metrics** — same content-integrity rules as the
  other surfaces.
- **Test the dark-mode invert** — set explicit `background`/`color` on text containers
  so client dark-mode remapping doesn't produce unreadable pairs.
