# What's Up! eCampus Plus

Chrome extension that enhances the **Schedule a class** experience in What's Up! eCampus.

## Problem

The native schedule screen includes class-type filters (`Face to Face`, `Have Fun`) that can conflict with custom UI overlays and make advanced UX iteration harder.

## Goal

Provide a compact, modern, and intuitive filter layer while preserving native scheduling behavior.

## Current behavior

### Scope

The extension UI is injected only on:

- `/Api/ScheduleAClass`
- `/Api/ScheduleAClassSchool`
- `/Api/ScheduleAClassLive`

### What the extension does

- Adds a compact **funnel icon trigger** next to native filter controls.
- Opens a compact panel with:
  - Class type (`All` / `Face to Face` / `Have Fun`)
  - Day selection (`MON` to `SAT`)
  - Time range slider (`09:30` to `21:30` by default)
- Keeps panel collapsed by default.
- Closes panel when:
  - user clicks outside, or
  - user clicks the close button (`×`) in the panel.
- The panel is anchored to the filter toolbar (it does not stay fixed on viewport scroll).
- Hides native `Face to Face` / `Have Fun` controls to avoid duplicated filter sources.
- Leaves native `School` / `Live` controls untouched.
- Applies filtering only to rows that are natively visible in the current schedule view.

### What the extension does NOT do

- It does not schedule classes.
- It does not cancel classes.
- It does not modify native `School` / `Live` logic.

## Extension popup (runtime toggle)

Click the extension icon in Chrome toolbar to open the popup.

Available control:

- **Enable on this site**
  - ON: apply eCampus Plus DOM enhancements.
  - OFF: disable enhancements and show native view immediately.

## Classification logic

Class type is inferred from row title:

- If title contains `Face to Face` → `Face to Face`
- Otherwise → `Have Fun`

## Features

- Compact, modern filter UI integrated near native controls.
- Collapsed-by-default interaction.
- Real-time class-type filtering.
- Accurate counters based on natively visible rows.
- Runtime enable/disable toggle from extension popup.
- Filter preference persistence with `chrome.storage.sync`.

## Tech stack

- Manifest V3
- Vanilla JavaScript content script + popup
- No build step required

## Installation (developer mode)

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.
6. Open eCampus schedule page:
   - `https://ecampus.whatsup.es/Api/ScheduleAClass`

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
    └── content.js
```

## Safety guardrails

- No auto-clicking booking buttons.
- No schedule/cancel triggers.
- Client-side row visibility only.

## License

MIT
