# What's Up! eCampus Plus

Chrome extension that improves UX in **Schedule a class** and selected **Snacks** exercises in What's Up! eCampus.

## Quick start

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. Open:
   - `https://ecampus.whatsup.es/Api/ScheduleAClass`
   - `https://ecampus.whatsup.es/snacks/*`

## Scope

The extension UI is injected only on:

### Schedule module

- `/Api/ScheduleAClass`
- `/Api/ScheduleAClassSchool`
- `/Api/ScheduleAClassLive`

### Snacks module

- `/snacks/*`

## What it does

### Schedule UX

- Adds a compact filter trigger near native schedule filters.
- Opens a filter panel with:
  - Class Type (`All`, `Face to Face`, `Have Fun`)
  - Days (`MON` to `SAT`)
  - Time Range (`09:30` to `21:30`, default full range)
- Applies client-side filtering to natively visible schedule rows.
- Keeps native delivery filters (`School`, `Live`) as the source of truth.
- Provides a popup toggle (**Enable on this site**) for runtime on/off.

### Snacks UX

#### Word selection and gap filling

- Enables click-to-fill for word-bank style exercises.
- Auto-fills the active `snack-gap` input with the selected word.
- Supports `contenteditable`, text inputs, and textarea-like editable targets.
- Marks words as used after assignment.
- Preserves used-state when the input text is edited, and releases it only when the input is cleared.
- Allows repeated-word tracking via usage count badges when a word is used in multiple sentences.
- Shows a clear (`×`) button for each wrapped editable input.
- Clears the assignment and restores word availability when the input is cleared.

#### Word ordering (Duolingo-like)

- Converts word-ordering prompts into draggable token chips per sentence.
- Syncs token order in real time with the `snack-gap` input.
- Capitalizes only the first word in the generated input sentence.
- Preserves original token casing in draggable chips.
- Persists per-sentence token order for each snack route.
- Does not overwrite inputs that already contain a saved/corrected answer.

## Filter model (Schedule)

| Dimension | Managed by | Options |
|---|---|---|
| Delivery | Native eCampus | School / Live |
| Class Type | Extension | All / Face to Face / Have Fun |
| Days | Extension | MON / TUE / WED / THU / FRI / SAT |
| Time Range | Extension | 09:30–21:30 |

## Classification rule (Schedule)

Class type is inferred from row title:

- Title contains `Face to Face` -> `Face to Face`
- Otherwise -> `Have Fun`

## Architecture

- Manifest V3
- Schedule content script (`src/content.js`)
- Schedule content styles (`src/content.css`)
- Snacks content script (`src/exercise.js`)
- Snacks content styles (`src/exercise.css`)
- Popup UI (`popup.html`, `popup.css`, `popup.js`)
- Persistence via `chrome.storage.sync` and local snack state in `localStorage`

## Project structure

```text
.
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── README.md
└── src
    ├── content.css
    ├── content.js
    ├── exercise.css
    └── exercise.js
```

## Troubleshooting

- **Trigger not visible (Schedule).**
  - Ensure you are on one of the supported `/Api/ScheduleAClass*` routes.
  - Reload extension from `chrome://extensions`.

- **Drag-and-drop chips do not appear (Snacks).**
  - Ensure you are on a supported `/snacks/*` exercise with a word-ordering pattern.
  - Reload the extension and refresh the page.

- **Filters do not update (Schedule).**
  - Toggle extension OFF/ON from popup.
  - Refresh the eCampus page.

- **Unexpected behavior after updates**
  - Reload extension and hard refresh the tab.

## Limitations

- Class type detection depends on schedule row title text.
- Snacks enhancements target known word-ordering structures; major DOM changes in eCampus may require selector updates.

## Safety

- No schedule/cancel automation.
- No button auto-clicking.
- UI/DOM assistance only.
