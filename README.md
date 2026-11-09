# Gemini Studio

A local web UI for the Gemini CLI: chats, reasoning steps, a built-in file browser and diff viewer, voice input.
It runs on your own machine (it only listens on `127.0.0.1`) and uses your own Gemini login and chat history.

## What you need

1. **Node.js 18 or newer** — https://nodejs.org
2. **The Gemini CLI, installed and signed in** — run `npm install -g @google/gemini-cli`, then run `gemini` once in a
   terminal and sign in with your Google account.
3. **Chrome or Edge** for the best experience (voice input only works there; the browser sends the audio to its
   speech service).

There is nothing to install for the app itself (no `npm install`).

## Start it

Windows: double-click **start.bat**.
Anywhere: in this folder run

```
node server.js
```

It opens http://localhost:4545 in your browser. Use another port with `node server.js 5000`, and add `--no-open` to
skip opening the browser. Press Ctrl+C in the terminal to stop it.

After updating the files, stop it and start it again (the page itself only needs a hard refresh, Ctrl+F5).

## Good to know

- New chats run Gemini in **auto-approve mode ("yolo")** by default: it can edit files and run commands in the folder
  you choose without asking. Change it with the selector under the message box if you want it to ask first.
- Chats are the Gemini CLI's own sessions (in `~/.gemini`), so they also show up in the `gemini` terminal, and the
  other way round.
- Uploaded attachments are copied to `~/.gemini-ui/uploads`.
- If the Gemini CLI is installed somewhere unusual, set `GEMINI_JS` to the path of its `gemini.js`.
