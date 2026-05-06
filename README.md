# Matrix Course Viewer

Browser-based learning management system for Matrix TSL courses built on Flowcode and E-blocks 3.

## Courses

- **CO0001** — Flowcode & E-blocks 3 CPD course
- **CO0002** — Introduction to Microcontrollers
- **CO0003** — Digital Techniques for Aviation Technicians (EASA Unit 5)

## Features

- Renders six screen types: Image, HTML, YouTube, PDF, Document (Word), PowerPoint
- Per-course progress tracking in `localStorage`
- Toggle screens complete / incomplete
- Printable certificate of completion when 100% complete
- Word documents (`.docx`) rendered inline in-browser via [mammoth.js](https://github.com/mwilliamson/mammoth.js)

## Run locally

No npm install required — uses only Node built-ins.

```sh
node server.js
```

Opens on `http://localhost:4173/`.

## Edit course content

Edit `data/courses.json` to change screen lists, add courses, or update file paths. Drop new content files (`.docx`, `.htm`, `.pdf`, etc.) into `content/` and reference them from `courses.json`.

## License

© Matrix TSL.
