# daisyUI Themes

## Apply a Theme

```html
<html data-theme="dark">
<!-- or any of 35+ built-in themes -->
```

## Built-in Themes

`light` `dark` `cupcake` `bumblebee` `emerald` `corporate` `synthwave` `retro` `cyberpunk` `valentine` `halloween` `garden` `forest` `aqua` `lofi` `pastel` `fantasy` `wireframe` `black` `luxury` `dracula` `cmyk` `autumn` `business` `acid` `lemonade` `night` `coffee` `winter` `dim` `nord` `sunset` `caramellatte` `abyss` `silk`

## Custom Theme

```css
@plugin "daisyui" {
  themes: light --default, dark,
  mytheme {
    primary: oklch(65% 0.3 340);
    secondary: oklch(70% 0.25 200);
    accent: oklch(75% 0.2 150);
    neutral: oklch(40% 0.02 264);
    base-100: oklch(98% 0.01 264);
  }
}
```

Note: v5 custom themes use oklch colour space, not hex.

## Theme Switcher Pattern

```html
<select data-choose-theme class="select select-bordered">
  <option value="light">Light</option>
  <option value="dark">Dark</option>
  <option value="cyberpunk">Cyberpunk</option>
</select>

<script>
  // Use theme-change package or manual:
  document.querySelector('[data-choose-theme]').addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
  });
</script>
```
