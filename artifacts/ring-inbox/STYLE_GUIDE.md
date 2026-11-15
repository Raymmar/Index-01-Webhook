# Ring Inbox styles

## Source of truth

`src/index.css` owns the semantic color, typography, spacing, and radius tokens.
Tailwind utilities and Clerk appearance settings consume those same variables.
Do not copy literal colors into page components or the Clerk configuration.

The app uses its existing warm light palette, including native audio and form
controls. A device's dark appearance must not independently change those controls.
There is no separate dark palette.

## Colors and edges

| Role | Token | Usage |
| --- | --- | --- |
| Page | `background` | Warm neutral page background |
| Surface | `card`, `popover` | Cards, forms, dialogs |
| Text | `foreground` | Main text and transcripts |
| Supporting text | `muted-foreground` | Metadata, labels, helper text |
| Neutral edge | `border` | Light warm-gray card edges, dividers, fields |
| Subtle fill | `secondary`, `muted` | Hover/selected and quiet surfaces |
| Main action | `primary`, `primary-foreground` | Filled action buttons |
| Accent | `accent`, `ring` | Live status, credential emphasis, keyboard focus |
| Error | `destructive` | Errors and destructive states |

- Pair border widths with an explicit semantic color: `border border-border`,
  `border-t border-border`, `border-l border-border`.
- Lists use `divide-y divide-border`. Pseudo-elements share the neutral default.
- `input`, `card-border`, `popover-border`, and `sidebar-border` alias `border`.
  Change the neutral edge once, not independently per component.
- Keep intentionally accented credential panels and error borders semantic.
  Never use text color (`currentColor`) as an ordinary surface edge.
- Focus indicators use `ring-ring`; do not remove keyboard focus visibility.
- Avoid `!important` blanket border overrides: they erase error and focus states.

## Typography and shape

- Transcripts and action titles share `app-content-text`: Geist, 16px regular.
- Main views share `app-page`. Width and responsive padding come from
  `--app-page-max-width` (64rem), `--app-page-padding-inline`, and
  `--app-page-padding-block`. Adjust these centrally, not with page-specific overrides.
- Display headings: Instrument Serif; code and copied values: Geist Mono.
- Keep the current compact card spacing, 8px card radius and 6px control radius.
- A color-system change is not permission to resize text, increase weight, or
  change the layout.

## Checking changes

Check Inbox cards and footer separators, webhook rows and copy controls, empty
states, confirmation dialogs, and Clerk login/signup surfaces. Verify both
development CSS and a production build. Native controls should remain light
even when the device prefers dark mode.
