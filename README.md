# Study Vault

An offline-first Electron study planner built for course imports, AI-assisted structure, workload planning, quiz practice, and study analytics.

## Features

- Import course content from PDF, Markdown, JSON, or text.
- Split course material into study sections.
- Build study tasks from course sections.
- Capacity-aware auto-planning into available study windows.
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


<img width="1177" height="1127" alt="Screenshot 2026-06-25 193505" src="https://github.com/user-attachments/assets/1ee8ac2b-0dc6-468f-99ce-e809bda4e94c" />
<img width="1095" height="1121" alt="Screenshot 2026-06-25 193501" src="https://github.com/user-attachments/assets/d5f80e67-35b2-491c-af9c-dc423ad84fdb" />
<img width="3835" height="1118" alt="Screenshot 2026-06-25 193454" src="https://github.com/user-attachments/assets/a809da8e-190e-46ac-99c5-13721f04868c" />
<img width="3492" height="457" alt="Screenshot 2026-06-25 193447" src="https://github.com/user-attachments/assets/012cf089-2c58-4d56-9b84-1717f9651f26" />
<img width="3826" height="1635" alt="Screenshot 2026-06-27 131222" src="https://github.com/user-attachments/assets/82c54c8f-c019-4930-b1e2-9a78c4c816d6" />

<img width="3837" height="1817" alt="Screenshot 2026-06-25 193431" src="https://github.com/user-attachments/assets/1a401497-f61f-4c89-9790-d21786ff1df3" />
<img width="3833" height="2031" alt="Screenshot 2026-06-25 193421" src="https://github.com/user-attachments/assets/2bbf8c16-1e61-48f6-b728-7cf5f2629f50" />
<img width="3835" height="2023" alt="Screenshot 2026-06-25 193416" src="https://github.com/user-attachments/assets/320e7489-8565-4acd-8280-91345b262119" />
<img width="3828" height="1657" alt="Screenshot 2026-06-25 193409" src="https://github.com/user-attachments/assets/f8b72f86-6e80-4092-95d9-3022308d7e15" />

