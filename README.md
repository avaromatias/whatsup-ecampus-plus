# What's Up! eCampus Plus

Chrome extension that improves class discovery in the **Schedule a class** view of What's Up! eCampus.

## Quick start

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. Open:
   - `https://ecampus.whatsup.es/Api/ScheduleAClass`

## Scope

The extension UI is injected only on:

- `/Api/ScheduleAClass`
- `/Api/ScheduleAClassSchool`
- `/Api/ScheduleAClassLive`

## What it does

- Adds a compact filter trigger near native schedule filters.
- Opens a filter panel with:
  - Class Type (`All`, `Face to Face`, `Have Fun`)
  - Days (`MON` to `SAT`)
  - Time Range (`09:30` to `21:30`, default full range)
- Applies client-side filtering to natively visible schedule rows.
- Keeps native delivery filters (`School`, `Live`) as the source of truth.
- Provides a popup toggle (**Enable on this site**) for runtime on/off.

## Filter model

| Dimension | Managed by | Options |
|---|---|---|
| Delivery | Native eCampus | School / Live |
| Class Type | Extension | All / Face to Face / Have Fun |
| Days | Extension | MON / TUE / WED / THU / FRI / SAT |
| Time Range | Extension | 09:30–21:30 |

## Classification rule

Class type is inferred from row title:

- Title contains `Face to Face` -> `Face to Face`
- Otherwise -> `Have Fun`

## Architecture

- Manifest V3
- Content script (`src/content.js`)
- Content styles (`src/content.css`)
- Popup UI (`popup.html`, `popup.css`, `popup.js`)
- Persistence via `chrome.storage.sync`

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

## Troubleshooting

- **Trigger not visible**
  - Ensure you are on one of the supported `/Api/ScheduleAClass*` routes.
  - Reload extension from `chrome://extensions`.

- **Filters do not update**
  - Toggle extension OFF/ON from popup.
  - Refresh the eCampus page.

- **Unexpected behavior after updates**
  - Reload extension and hard refresh the tab.

## Limitations

- Class type detection depends on title text.
- DOM changes in eCampus may require selector updates.

## Safety

- No schedule/cancel automation.
- No button auto-clicking.
- Row visibility changes only.

