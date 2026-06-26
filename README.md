# Study Vault

An offline-first Electron study planner inspired by Shovel/Todoist workflows, built for course imports, AI-assisted structure, workload planning, quiz practice, and study analytics.

## Features

- Import course content from PDF, Markdown, JSON, or text.
- Split course material into study sections.
- Build study tasks from course sections.
- Shovel-style auto-planning into available study windows.
- Fixed schedule blocks and one-off exceptions.
- Exam date, cushion, pace, workload forecast, and readiness analytics.
- Task-level timer, study logs, subtasks, and spaced review task creation.
- Local Ollama-powered quiz generation and stats analysis.
- Backup and restore of Study Vault data.

## Documentation

See [Architecture And UML Documentation](docs/ARCHITECTURE_AND_UML.md) for the system overview, use cases, activity diagrams, sequence diagrams, class diagram, state diagrams, deployment diagram, data flows, and QA flow.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Test

Run the real Electron smoke test before packaging or pushing bigger UI changes:

```bash
npm run test:e2e
```

The test builds the app, creates a temporary course, imports sample content, builds study tasks, auto-plans, opens a task, logs time, completes it, checks Stats and Quiz, then verifies desktop, laptop, and narrow-window layouts for horizontal overflow.

Run a live Ollama smoke test:

```bash
npm run test:ai
```

Run a real PDF import smoke test:

```bash
npm run test:pdf -- "C:\path\to\course.pdf"
```

Run backup/restore sanity:

```bash
npm run test:backup
```

## Package

```bash
npm run package:win
```

The Windows build creates `dist\Study Vault Setup 1.0.0.exe`. Local builds are unsigned, so Windows may show the usual unknown-publisher warning.

## Local AI

Study Vault uses Ollama on this computer for quiz generation and AI stats analysis.

```bash
ollama serve
ollama pull mistral
```

The app checks `127.0.0.1:11434`. If Quiz or Stats says Ollama is offline, open Ollama or run `ollama serve`, then press the in-app check/analyze button again.
