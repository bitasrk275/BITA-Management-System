# Design

The BITA app's visual system: **"Plant Safety Signboard"** (chosen by Naveen, 27 Nov 2026, replacing the 6 Nov black-and-white style after BITA found the old screens hard to use). Product facts live in `PRODUCT.md`.

## The idea

BITA's engineers read plant safety signs every working day. The office app speaks that language: each thing to do is a sign, and each sign colour has exactly one meaning.

| Sign | Shape | Meaning in the app |
| --- | --- | --- |
| Blue | circle | **You must act** (approve, assign, issue, answer). Also the colour of the one primary button. |
| Yellow | triangle | **Caution / waiting** (calibration due soon, waiting for someone else). Always black text on yellow. |
| Green | square with a tick | **Done** (step finished, paid, ready to close). |
| Red | circle with a bar | **Overdue / stop** (payment overdue, expired certificate). |

Colour never appears alone: every status shows the shape and words too (`SignSymbol`, `Status`).

## Principles

- **Five places, not a long menu.** Today, Jobs, Reports, Money, Records. Every page belongs to one place and is listed under it; nothing is removed, only grouped.
- **One next step per screen.** A job page shows its route (Enquiry → Quote / PO → On site → Report → Invoice → Paid) and one blue "Next step" box with one button. Secondary detail and edit forms fold away (`Fold`).
- **Plain words, short help.** Help text is one sentence. Labels name the action ("Make an invoice", "Record payment").
- **Readable on site.** Body 15px, labels 14px, nothing smaller than 13px. Strong contrast on a white ground for outdoor daylight. Touch targets at least 44px.
- **Every screen fits every width.** No sideways scrolling at 375px; wide tables scroll inside themselves.

## Layout

- **Desktop and tablet (≥768px):** a 248px left rail on `side` grey. The five places are big condensed labels; the open place shows its pages underneath. Content is capped at 1200px.
- **Phone (<768px):** top bar with the BITA mark, search and Log out; the current place's pages as large tabs under it; the five places as a fixed bottom bar at thumb height (64px, safe-area aware).
- Grid columns may shrink below their content (`main .grid > * { min-width: 0 }`), so long names never widen the page.

## Tokens (in `app/globals.css`)

| Token | Value | Use |
| --- | --- | --- |
| `ink` | #111418 | Text |
| `ink-2` | #3d4450 | Secondary text |
| `ink-3` | #646b76 | Meta text (still ≥4.5:1 on white) |
| `line` | #d6dae0 | Borders |
| `line-2` | #eceef1 | Row separators |
| `side` | #f3f4f6 | Rail and quiet surfaces |
| `surface` / `surface-2` | #ffffff / #f5f6f8 | Panels, hover rows |
| `sign` / `sign-deep` | #0055a4 / #003f7d | Act: primary button, current step, counts |
| `caution` | #f5b400 | Yellow sign plates (black text only) |
| `ok` | #17803d | Done |
| `wait` | #b45309 | Waiting, as text or symbol outline |
| `bad` | #c81e1e | Overdue / stop |

## Type

- **Barlow** (body, labels, buttons) and **Barlow Condensed** 600/700 (`font-sign`: page titles, section titles, sign titles, navigation, big numbers). Barlow comes from road and plant signage lettering.
- **Geist Mono** only for codes people read character by character (Job IDs, report numbers, serials).
- Sizes: page title 28px phone / 32px desktop; section title 21px; sign title 19px; body 15px; meta 13–14px; daily numbers 30–34px tabular.

## Shape and depth

- Panels: 8px radius, 1px `line` border, no shadow. Buttons and fields: 6px radius, at least 44px tall (36px for the small size).
- The only shadow is on floating menus (search results).
- The next-step box is the one place with a 2px `sign` border.

## Components (`components/ui.tsx`, `components/app-shell.tsx`)

- `AppShell`: the five places per role (management, office, reviewer); rail on desktop, bottom bar on phone. The technician area keeps its own phone layout.
- `PageHeader`, `SectionTitle`, `Stats` (the daily numbers, 2 columns on phone, 4 on desktop).
- `SignBoard` + `Sign`: the Today screen's to-do list. Each sign is one link: colour plate with pictogram and word (Act / Waiting / Done / Overdue), title, one-line detail, action.
- `StepRoute`: the job's six steps; done = green tick, current = blue, to do = grey ring. 3 columns on phone, 6 on desktop.
- `Fold`: folds secondary detail and edit forms.
- `List` + `ListRow`, `EmptyRow`, `Status` / `StatusDot` / `SignSymbol`, `Badge`, `Mono`, `Avatar`, `Card` (never nested).
- `Button` (blue), `SecondaryButton` / `ButtonLink variant="secondary"` (white, dark outline), `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `ErrorNote`, `SavedNote`.

Screens use only these components and the tokens above. A new component goes into `components/ui.tsx`; screens never define their own colours or fonts.

## Don'ts

- No yellow text on white (unreadable); yellow is a plate colour only.
- No red or yellow for decoration: a sign colour on screen always means its status.
- No second blue button in the same area; one primary action.

## Exceptions

Inspection reports (`templates/reports/`) and the printed invoice and quotation layouts reproduce BITA's own paper formats, so they follow BITA's layout, not this system.
