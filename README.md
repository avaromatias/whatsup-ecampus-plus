# What's Up! eCampus Plus

Chrome extension that adds **multi-filter scheduling** to the "Schedule a class" screen in What's Up! eCampus.

## Problem

The native eCampus scheduling screen exposes four filters:

- Face to Face
- Have Fun
- School
- Live

By default, only one server-side filter can be applied at a time.

## Goal

Allow students to combine filters in a way that matches business logic:

- Class Type: `Face to Face` **or** `Have Fun`
- Delivery: `School` **or** `Live`
- Final view: any valid combination across both groups (e.g. `Face to Face + School`)

## Current approach (MVP)

This version uses a **client-side filtering layer** on top of the base schedule page.

- It does **not** schedule or cancel classes.
- It only shows/hides existing class rows.
- It keeps the original eCampus UI and actions intact.

### Classification logic used in MVP

Because the platform does not expose a documented multi-filter endpoint, this MVP infers class metadata from row titles:

- `Face to Face` if title includes `Face to Face`
- Otherwise class type is treated as `Have Fun`
- `Live` if title includes pattern like `(L07-12)`
- Otherwise delivery is treated as `School`

> Note: this heuristic is intentionally simple for v1. We can move to a data-driven strategy in v2 if needed.

## Features

- Floating filter panel inside eCampus
- Multi-filter combinations with valid group constraints
- Real-time row filtering
- Lightweight refresh action
- Persistent filter preferences using `chrome.storage.sync`

## Tech stack

- Manifest V3
- Vanilla JavaScript content script
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
├── README.md
└── src
    ├── content.css
    └── content.js
```

## Safety guardrails

- This extension does not auto-click booking buttons.
- This extension does not trigger schedule/cancel actions.
- It only modifies row visibility (`display: none`) on the client.

## Roadmap

- Better type/delivery detection via API payloads (optional)
- Optional compact mode for schedule cards
- Time-range and day filters
- Saved presets
- Toggle between native and enhanced filtering

## License

MIT
